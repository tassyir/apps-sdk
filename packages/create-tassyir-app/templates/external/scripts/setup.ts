import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// `npm run setup`: writes .env from .env.example, with a new random
// TOKEN_STORE_KEY. An existing .env is never touched.

const root = join(import.meta.dirname, '..');
const target = join(root, '.env');

if (existsSync(target)) {
  console.log('.env already exists: left as it is.');
} else {
  const key = randomBytes(32).toString('base64');
  const text = readFileSync(join(root, '.env.example'), 'utf8').replace(
    /^TOKEN_STORE_KEY=.*$/m,
    `TOKEN_STORE_KEY=${key}`,
  );
  writeFileSync(target, text, { mode: 0o600 });
  console.log(
    'Wrote .env with a new TOKEN_STORE_KEY.\nNext: put TASSYIR_CLIENT_ID, TASSYIR_CLIENT_SECRET and TASSYIR_APP_ID from the developer console in it (README.md, step 3).',
  );
}
