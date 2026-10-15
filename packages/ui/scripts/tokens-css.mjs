// Writes dist/tokens.css (the `@tassyir/ui/tokens.css` export) from the
// built tokens module, so the file and the sheet the elements adopt are the
// same text. Runs after tsdown (npm run build).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/', import.meta.url);
/** @type {unknown} */
const loaded = await import(new URL('tokens.js', dist).href);
const tokens = /** @type {{ tokensCss: () => string }} */ (loaded);
const file = fileURLToPath(new URL('tokens.css', dist));
writeFileSync(file, `${tokens.tokensCss()}\n`);
console.log(`Wrote ${file}`);
