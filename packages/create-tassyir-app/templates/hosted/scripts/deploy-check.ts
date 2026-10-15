import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { validateManifest } from '@tassyir/app-manifest';
import { parse } from 'smol-toml';
import {
  buildHostedBundle,
  checkBundleCode,
  isCliError,
  validateHostedBundle,
} from 'tassyir';
import type { CliProblem } from 'tassyir';

// `npm run deploy:check [-- --json]`: what `tassyir deploy` checks before it
// uploads anything, with nothing uploaded and no sign-in. The Worker is
// bundled the way Tassyir Hosting runs it (src/worker.ts → one ES module,
// the built page inside), then held to the API's upload rules and the
// scan's code checks: no Node.js built-in, a fetch handler, no code built
// from strings, no WebAssembly, no import of a computed name, every outside
// host in hosting.allowed_hosts, no request to a Tassyir host. Exit 1 on a
// problem. Run `npm run build` first (npm run deploy:check does).

const json = process.argv.includes('--json');
const root = join(import.meta.dirname, '..');

function fail(problems: readonly CliProblem[]): never {
  if (json) {
    console.log(JSON.stringify({ ok: false, errors: problems }, null, 2));
  } else {
    for (const problem of problems) {
      console.error(
        `✗ ${problem.code}${problem.path ? ` at ${problem.path}` : ''}: ${problem.message}\n  Fix: ${problem.fix}`,
      );
    }
  }
  process.exit(1);
}

const manifest = validateManifest(
  parse(readFileSync(join(root, 'tassyir.app.toml'), 'utf8')),
);
if (!manifest.ok) {
  fail(manifest.errors);
}
const { hosting } = manifest.manifest;
const allowedHosts = hosting.mode === 'tassyir' ? hosting.allowed_hosts : [];

let built: Awaited<ReturnType<typeof buildHostedBundle>>;
try {
  built = await buildHostedBundle({ cwd: root, root });
} catch (error) {
  if (isCliError(error)) {
    fail(
      error.errors?.length
        ? error.errors
        : [
            {
              code: error.code,
              path: '',
              message: error.message,
              fix: error.fix ?? '',
            },
          ],
    );
  }
  throw error;
}

const rules = validateHostedBundle(built.bundle);
const code = checkBundleCode(
  built.bundle.files,
  built.bundle.main,
  allowedHosts,
  (file, line, column) => built.locate(file, line, column),
);
const problems = [...(rules.ok ? [] : rules.errors), ...code.errors];
if (problems.length > 0) fail(problems);

const bytes = rules.ok ? rules.bytes : 0;
const lockfile = built.bundle.lockfile?.name ?? null;
if (json) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        entry: built.entry,
        main: built.bundle.main,
        bytes,
        lockfile,
        warnings: [...built.warnings, ...code.warnings],
      },
      null,
      2,
    ),
  );
} else {
  for (const warning of [...built.warnings, ...code.warnings]) {
    console.warn(`! ${warning}`);
  }
  console.log(
    `✓ ${relative(root, join(root, built.entry))} bundles into ${built.bundle.main} (${(bytes / 1024).toFixed(1)} KB${lockfile ? `, with ${lockfile}` : ''}) and passes the API's bundle rules and the scan's code checks. Nothing was uploaded: npm run deploy uploads it.`,
  );
}
