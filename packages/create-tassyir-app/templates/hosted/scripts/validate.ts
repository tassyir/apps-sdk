import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest } from '@tassyir/app-manifest';
import type { ManifestError } from '@tassyir/app-manifest';
import { parse, TomlError } from 'smol-toml';

// `npm run validate [-- --json]`: checks tassyir.app.toml with the Tassyir
// API's own validator (@tassyir/app-manifest), before you deploy it. Every
// error has a stable code, the field's path and a fix. Exit 1 on an error.

interface Note {
  code: string;
  path: string;
  message: string;
  fix: string;
}

const json = process.argv.includes('--json');
const file = join(import.meta.dirname, '..', 'tassyir.app.toml');

function finish(errors: (ManifestError | Note)[], notes: Note[]): never {
  if (json) {
    console.log(
      JSON.stringify({ ok: errors.length === 0, errors, notes }, null, 2),
    );
  } else {
    for (const error of errors) {
      console.error(
        `✗ ${error.code} at ${error.path || '(document)'}: ${error.message}\n  Fix: ${error.fix}`,
      );
    }
    for (const note of notes) {
      console.warn(
        `! ${note.code} at ${note.path}: ${note.message}\n  Fix: ${note.fix}`,
      );
    }
    if (errors.length === 0) console.log('✓ tassyir.app.toml is valid');
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

let parsed: unknown;
try {
  parsed = parse(readFileSync(file, 'utf8'));
} catch (error) {
  if (!(error instanceof TomlError)) throw error;
  finish(
    [
      {
        code: 'MANIFEST_TOML_INVALID',
        path: '',
        message: `tassyir.app.toml is not valid TOML (line ${String(error.line)}, column ${String(error.column)}): ${error.message.split('\n')[0] ?? ''}`,
        fix: 'Fix the TOML syntax at that line.',
      },
    ],
    [],
  );
}

const result = validateManifest(parsed);
if (!result.ok) finish(result.errors, []);

const notes: Note[] = [];
const { hosting } = result.manifest;
if (hosting.mode !== 'tassyir') {
  notes.push({
    code: 'HOSTING_MODE_EXTERNAL',
    path: 'hosting.mode',
    message: 'This project is built for Tassyir Hosting (src/worker.ts)',
    fix: 'Keep hosting.mode = "tassyir", or move the app to your own server first (create-tassyir-app --template external shows how).',
  });
}
finish([], notes);
