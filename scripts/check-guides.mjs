// Typechecks every TypeScript sample of the developer guides (docs/guides)
// the way a developer's project meets the packages:
//   1. packs @tassyir/app, @tassyir/app-bridge and @tassyir/app-manifest
//      (this commit's tarballs: they may not be on npm yet);
//   2. installs them in a scratch project, with smol-toml and @types/node at
//      this repo's versions, from npm;
//   3. writes each ```ts sample as a server module (Node 22 types, no DOM,
//      NodeNext) and each ```ts browser sample as a page module (the DOM, no
//      Node, bundler resolution), with the names the guides set up once
//      (tassyir, admin, installationId; bridge) declared;
//   4. runs this repo's tsc on both, libraries included (skipLibCheck off),
//      and reports each error at its line in the guide.
// The rest of the guides' checks (front matter, links, leaks, TOML and JSON,
// errors.md) are scripts/guides.test.mjs, in `npm test`.
// Needs the network (npm) and `npm run build` first. Usage:
//   npm run build && npm run check:guides [-- --keep]

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { codeBlocks, parseGuide } from './lib/guides.mjs';
import {
  ROOT,
  packedTarball,
  readJson,
  run,
  workspaces,
} from './lib/workspace.mjs';

const NPM_REGISTRY = 'https://registry.npmjs.org/';
const PACKAGES = [
  '@tassyir/app',
  '@tassyir/app-bridge',
  '@tassyir/app-manifest',
];
const GUIDES = join(ROOT, 'docs', 'guides');
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');

/** The compiler options a project made with create-tassyir-app uses, libraries checked too. */
const STRICT = {
  strict: true,
  noUncheckedIndexedAccess: true,
  noImplicitOverride: true,
  noFallthroughCasesInSwitch: true,
  verbatimModuleSyntax: true,
  moduleDetection: 'force',
  noEmit: true,
  skipLibCheck: false,
};
const SERVER = {
  compilerOptions: {
    ...STRICT,
    target: 'ES2023',
    lib: ['ES2023'],
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    types: ['node'],
  },
  include: ['server/*.ts', 'ambient-server.d.ts'],
};
const BROWSER = {
  compilerOptions: {
    ...STRICT,
    target: 'ES2022',
    lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'Bundler',
    types: [],
  },
  include: ['browser/*.ts', 'ambient-browser.d.ts'],
};
const AMBIENT_SERVER = `// The names the guides set up once (docs/guides/index.md, "About the code").
declare const tassyir: import('@tassyir/app').TassyirApp;
declare const admin: import('@tassyir/app').AdminClient;
declare const installationId: string;
`;
const AMBIENT_BROWSER = `declare const bridge: import('@tassyir/app-bridge').AppBridge;
`;

const keep = process.argv.includes('--keep');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tassyir-guides-')));

try {
  // The samples, each a module of its own.
  /** @type {Map<string, { guide: string, line: number }>} file → where it comes from */
  const origins = new Map();
  mkdirSync(join(scratch, 'server'));
  mkdirSync(join(scratch, 'browser'));
  const files = readdirSync(GUIDES)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort();
  for (const file of files) {
    const guide = parseGuide(
      file.slice(0, -3),
      readFileSync(join(GUIDES, file), 'utf8'),
    );
    let index = 0;
    for (const block of codeBlocks(guide.body, guide.bodyLine)) {
      if (block.lang !== 'ts') continue;
      index += 1;
      const kind = block.meta === 'browser' ? 'browser' : 'server';
      const name = `${kind}/${guide.slug}-${String(index)}.ts`;
      writeFileSync(join(scratch, name), `${block.code}\nexport {};\n`);
      origins.set(name, { guide: `docs/guides/${file}`, line: block.line });
    }
  }
  console.log(
    `✓ ${String(origins.size)} TypeScript samples in ${String(files.length)} guides`,
  );

  // This repo's tarballs, and the rest from npm.
  const packs = join(scratch, 'packs');
  mkdirSync(packs);
  /** @type {Record<string, string>} */
  const dependencies = {};
  for (const { dir, folder, manifest } of workspaces()) {
    const name = manifest.name ?? folder;
    if (!PACKAGES.includes(name)) continue;
    if (!existsSync(join(dir, 'dist'))) {
      throw new Error(
        `packages/${folder} has no dist/: run npm run build first`,
      );
    }
    const packed = packedTarball(
      run('npm', ['pack', dir, '--pack-destination', packs, '--json']).stdout,
    );
    dependencies[name] = `file:${join(packs, packed.filename)}`;
  }
  const missing = PACKAGES.filter((name) => !(name in dependencies));
  if (missing.length > 0)
    throw new Error(`no workspace for ${missing.join(', ')}`);
  dependencies['smol-toml'] = installedVersion('smol-toml');
  writeFileSync(
    join(scratch, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies,
        devDependencies: { '@types/node': installedVersion('@types/node') },
      },
      null,
      2,
    )}\n`,
  );
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--ignore-scripts',
      `--registry=${NPM_REGISTRY}`,
      `--@tassyir:registry=${NPM_REGISTRY}`,
    ],
    { cwd: scratch },
  );
  console.log(`✓ installed ${Object.keys(dependencies).join(', ')}`);

  writeFileSync(join(scratch, 'ambient-server.d.ts'), AMBIENT_SERVER);
  writeFileSync(join(scratch, 'ambient-browser.d.ts'), AMBIENT_BROWSER);
  writeFileSync(
    join(scratch, 'tsconfig.server.json'),
    JSON.stringify(SERVER, null, 2),
  );
  writeFileSync(
    join(scratch, 'tsconfig.browser.json'),
    JSON.stringify(BROWSER, null, 2),
  );

  /** @type {string[]} */
  const errors = [];
  for (const project of ['tsconfig.server.json', 'tsconfig.browser.json']) {
    const result = run(TSC, ['-p', project, '--pretty', 'false'], {
      cwd: scratch,
      allowFailure: true,
    });
    errors.push(...located(`${result.stdout}${result.stderr}`, origins));
    if (result.status !== 0 && errors.length === 0) {
      throw new Error(
        `tsc -p ${project} failed:\n${result.stdout}${result.stderr}`,
      );
    }
  }
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    const server = [...origins.keys()].filter((name) =>
      name.startsWith('server/'),
    );
    console.log(
      `✓ typechecked ${String(server.length)} server and ${String(origins.size - server.length)} page samples against the packed packages`,
    );
  }
} finally {
  if (keep) console.log(`Kept ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
}

/**
 * The exact version of a package this repo has installed.
 * @param {string} name
 * @returns {string}
 */
function installedVersion(name) {
  const manifest = /** @type {{ version?: string }} */ (
    readJson(join(ROOT, 'node_modules', ...name.split('/'), 'package.json'))
  );
  if (!manifest.version) throw new Error(`${name} is not installed`);
  return manifest.version;
}

/**
 * tsc's errors, each moved to its line in the guide when it is in a sample.
 * @param {string} output
 * @param {Map<string, { guide: string, line: number }>} origins
 * @returns {string[]}
 */
function located(output, origins) {
  /** @type {string[]} */
  const errors = [];
  for (const line of output.split('\n')) {
    const match = /^(.+?)\((\d+),(\d+)\): (error TS\d+: .*)$/.exec(line);
    if (!match) {
      if (/error TS\d+/.test(line)) errors.push(line);
      continue;
    }
    const [, file = '', row = '0', column = '0', message = ''] = match;
    const origin = origins.get(file);
    errors.push(
      origin
        ? `${origin.guide}:${String(origin.line + Number(row) - 1)}:${column} ${message}`
        : `${relative(ROOT, join(scratch, file))}(${row},${column}): ${message}`,
    );
  }
  return errors;
}
