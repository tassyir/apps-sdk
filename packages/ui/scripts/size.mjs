// Reports what @tassyir/ui weighs in an app's bundle: the whole package, the
// shared core every element carries (base class, tokens), and each element
// bundled alone with what it needs, minified (tsdown/rolldown) and gzipped.
// Usage: npm run size -w @tassyir/ui [-- --json]
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'tsdown';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../', import.meta.url));

/**
 * Each element, the module that holds it and its class (index.ts's ELEMENTS).
 * @type {[tag: string, module: string, className: string][]}
 */
const ELEMENTS = [
  ['tsy-button', 'button', 'TsyButton'],
  ['tsy-link', 'link', 'TsyLink'],
  ['tsy-text-field', 'text-field', 'TsyTextField'],
  ['tsy-select', 'select', 'TsySelect'],
  ['tsy-checkbox', 'checkbox', 'TsyCheckbox'],
  ['tsy-radio-group', 'radio', 'TsyRadioGroup'],
  ['tsy-card', 'card', 'TsyCard'],
  ['tsy-page-header', 'page-header', 'TsyPageHeader'],
  ['tsy-table', 'table', 'TsyTable'],
  ['tsy-status-pill', 'status-pill', 'TsyStatusPill'],
  ['tsy-banner', 'banner', 'TsyBanner'],
  ['tsy-empty-state', 'empty-state', 'TsyEmptyState'],
  ['tsy-skeleton', 'skeleton', 'TsySkeleton'],
  ['tsy-spinner', 'spinner', 'TsySpinner'],
];

const scratch = mkdtempSync(join(tmpdir(), 'tassyir-ui-size-'));

/**
 * Bundles `code` (an entry module) minified and returns its sizes in bytes.
 * @param {string} name
 * @param {string} code
 */
async function measure(name, code) {
  const entry = join(scratch, `${name}.ts`);
  const out = join(scratch, `out-${name}`);
  writeFileSync(entry, code);
  await build({
    config: false,
    cwd: PACKAGE,
    entry: [entry],
    outDir: out,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    dts: false,
    clean: true,
    logLevel: 'silent',
    treeshake: true,
  });
  const files = readdirSync(out).filter((file) => file.endsWith('.js'));
  const bytes = Buffer.concat(
    files.map((file) => readFileSync(join(out, file))),
  );
  return {
    minified: bytes.length,
    gzipped: gzipSync(bytes, { level: 9 }).length,
  };
}

/** @param {string} module */
const from = (module) => JSON.stringify(join(SRC, `${module}.ts`));

try {
  /** @type {{ name: string, minified: number, gzipped: number }[]} */
  const rows = [];
  const total = await measure('all', `export * from ${from('index')};\n`);
  const core = await measure(
    'core',
    `import { define, TsyElement } from ${from('element')};
     define('tsy-core', class extends TsyElement { constructor() { super(''); } refresh() {} });\n`,
  );
  for (const [tag, module, className] of ELEMENTS) {
    const extra =
      tag === 'tsy-radio-group'
        ? `import { TsyRadio } from ${from('radio')};\ndefine('tsy-radio', TsyRadio);\n`
        : '';
    rows.push({
      name: tag === 'tsy-radio-group' ? 'tsy-radio-group + tsy-radio' : tag,
      ...(await measure(
        module,
        `import { define } from ${from('element')};
         import { ${className} } from ${from(module)};
         define('${tag}', ${className});\n${extra}`,
      )),
    });
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total, core, elements: rows }, null, 2));
  } else {
    /** @param {number} bytes */
    const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
    console.log('| Import | Minified | Gzipped |');
    console.log('| --- | --- | --- |');
    console.log(
      `| everything (\`@tassyir/ui\`) | ${kb(total.minified)} | ${kb(total.gzipped)} |`,
    );
    console.log(
      `| the shared core (base class, tokens) | ${kb(core.minified)} | ${kb(core.gzipped)} |`,
    );
    for (const row of rows) {
      console.log(
        `| \`${row.name}\` alone, with the core | ${kb(row.minified)} | ${kb(row.gzipped)} |`,
      );
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
