import { createApp } from './app.ts';
// The page, built by `npm run build` (scripts/build.ts) and imported as
// text: what Tassyir Hosting runs is ONE module, this file bundled with
// everything it imports.
import html from '../dist/page/index.html';
import script from '../dist/page/app.js.txt';

// The Worker Tassyir Hosting runs: its default export's fetch(request, env,
// ctx) receives each request, with the installation's capabilities in
// ctx.props (never in env, which is empty).
export default createApp({ html, script });
