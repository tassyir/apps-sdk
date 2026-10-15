// The developer docs site, developers.tassyir.io: a Mintlify site whose root
// is site/ (Mintlify's monorepo path `/site`). Its pages come from sources
// this repo already checks, never from a copy someone edits by hand:
//
// - site/guides/<slug>.mdx from docs/guides/<slug>.md: the front matter's
//   title and description, the body without its `# Title` (Mintlify prints
//   the title), links between guides as site paths (Mintlify keeps a
//   `webhooks.md` link as it is, and `/guides/webhooks.md` is the page's
//   Markdown mirror), and MDX's special characters escaped (Mintlify parses
//   `.md` as MDX too: `{`, `<` and an HTML comment break the build);
// - site/errors/<kebab-code>.mdx, one page per problem code of the vendored
//   OpenAPI document, at the problem `type` URL
//   (https://developers.tassyir.io/errors/<code in kebab case>), with the
//   errors guide's "what to do" when it has one;
// - site/packages/<folder>.mdx from each public package's README;
// - site/openapi/*.json, the vendored OpenAPI documents byte for byte;
// - docs.json's `navigation` (the guides in front-matter `order`), and its
//   `colors`, `background` and `fonts` (from @tassyir/ui's tokens).
//
// scripts/docs-site.mjs (`npm run docs:sync`) writes them, and
// scripts/docs-site.test.mjs fails while any is stale.

import { posix } from 'node:path';
import {
  GENERATED_START,
  anchorOf,
  fencedLines,
  problemCodes,
} from './guides.mjs';

/** @typedef {import('./guides.mjs').Guide} Guide */
/** @typedef {import('./guides.mjs').OpenApiDocument} OpenApiDocument */
/** @typedef {{ title: string, description: string }} PageMeta */
/**
 * @typedef {{
 *   folder: string,
 *   name: string,
 *   description: string,
 *   readme: string,
 * }} PackageSource
 */
/**
 * @typedef {{
 *   source: string,
 *   group: string,
 *   directory: string,
 * }} OpenApiSource
 */

export const SITE_URL = 'https://developers.tassyir.io';
/** The base of every problem `type` the Admin API answers (plan §3.5). */
export const PROBLEM_TYPE_BASE = `${SITE_URL}/errors/`;
export const REPO_URL = 'https://github.com/tassyir/apps-sdk';

/**
 * The Mintlify CLI the scripts and CI run, exact and released at least 14
 * days before it was picked (4.2.957: 2026-09-30). npm resolves its
 * dependency tree no newer than MINT_BEFORE, without install scripts. It is
 * not a dev dependency: its tree is 860 MB and needs install scripts
 * (keytar, sharp, a telemetry postinstall), which this repo refuses.
 */
export const MINT_VERSION = '4.2.957';
export const MINT_BEFORE = '2026-10-01';

/** The folders of site/ that `npm run docs:sync` owns, file for file. */
export const GENERATED_DIRS = ['guides', 'errors', 'packages', 'openapi'];

/** The keys of site/docs.json that `npm run docs:sync` owns. */
export const GENERATED_KEYS = ['colors', 'background', 'fonts', 'navigation'];

/**
 * The OpenAPI documents the API reference shows, each copied byte for byte
 * into site/openapi/ (Mintlify reads files inside its root only).
 * @type {readonly OpenApiSource[]}
 */
export const OPENAPI_SOURCES = [
  {
    source: 'packages/app/openapi/openapi.2026-10.json',
    group: 'Admin API',
    directory: 'api-reference/admin',
  },
  {
    source: 'packages/cli/openapi/openapi.developer.json',
    group: 'Developer API',
    directory: 'api-reference/developer',
  },
];

/**
 * The pages of site/ written by hand, and the Guides tab group they sit in.
 * Every other page is generated.
 */
export const HAND_WRITTEN_GROUPS = [{ group: 'Tools', pages: ['claude-code'] }];

const ADMIN_PREFIX = '/apps/2026-10';

/**
 * A problem code as its `type` URL ends: `PERMISSION_DENIED` →
 * `permission-denied` (the backend's own rule).
 * @param {string} code
 */
export function kebab(code) {
  return code.toLowerCase().replace(/_/g, '-');
}

/** @param {string} code */
export function errorRoute(code) {
  return `/errors/${kebab(code)}`;
}

/** @param {string} slug */
export function guideRoute(slug) {
  return slug === 'index' ? '/guides' : `/guides/${slug}`;
}

// ---------------------------------------------------------------------------
// Markdown to MDX

/**
 * Applies `transform` to the prose of a Markdown text: everything outside
 * fenced code blocks and code spans, which are kept byte for byte.
 * @param {string} markdown
 * @param {(prose: string) => string} transform
 * @returns {string}
 */
export function mapProse(markdown, transform) {
  const lines = markdown.split('\n');
  const fenced = fencedLines(lines);
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  let chunk = [];
  const flush = () => {
    if (chunk.length === 0) return;
    out.push(mapInline(chunk.join('\n'), transform));
    chunk = [];
  };
  for (const [index, line] of lines.entries()) {
    if (fenced.has(index)) {
      flush();
      out.push(line);
    } else {
      chunk.push(line);
    }
  }
  flush();
  return out.join('\n');
}

/**
 * `transform` on the text between code spans (CommonMark: a run of N
 * backticks up to the next run of exactly N, within a paragraph).
 * @param {string} text
 * @param {(prose: string) => string} transform
 */
function mapInline(text, transform) {
  let result = '';
  let prose = '';
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '\\' && index + 1 < text.length) {
      prose += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char !== '`') {
      prose += char;
      index += 1;
      continue;
    }
    const open = runLength(text, index);
    let scan = index + open;
    let close = -1;
    while (scan < text.length) {
      if (text[scan] !== '`') {
        scan += 1;
        continue;
      }
      const length = runLength(text, scan);
      if (length === open) {
        close = scan;
        break;
      }
      scan += length;
    }
    if (close === -1 || text.slice(index, close).includes('\n\n')) {
      prose += text.slice(index, index + open);
      index += open;
      continue;
    }
    result += transform(prose) + text.slice(index, close + open);
    prose = '';
    index = close + open;
  }
  return result + transform(prose);
}

/**
 * @param {string} text
 * @param {number} start
 */
function runLength(text, start) {
  let end = start;
  while (text[end] === '`') end += 1;
  return end - start;
}

/**
 * Prose as MDX reads it as Markdown: an HTML comment is dropped, an autolink
 * becomes a link, and `{`, `}` and `<` are escaped (MDX would read an
 * expression or a JSX tag). Escapes already there are kept.
 * @param {string} prose
 */
export function escapeMdx(prose) {
  return prose
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(https?:\/\/[^\s<>]+)>/g, '[$1]($1)')
    .replace(/\\[\s\S]|[{}<]/g, (match) =>
      match.length === 2 ? match : `\\${match}`,
    );
}

/**
 * The target of every inline link (and image) of some prose, through
 * `resolve`.
 * @param {string} prose
 * @param {(target: string) => string} resolve
 */
export function rewriteLinks(prose, resolve) {
  return prose.replace(
    /\]\(([^)\s]*)((?:\s+"[^"]*")?)\)/g,
    (_, /** @type {string} */ target, /** @type {string} */ title) =>
      `](${resolve(target)}${title})`,
  );
}

/** @param {string} target */
function isAbsolute(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/');
}

/**
 * @param {string} target
 * @returns {[string, string]} the path and the `#anchor` (or '')
 */
function splitAnchor(target) {
  const hash = target.indexOf('#');
  return hash === -1
    ? [target, '']
    : [target.slice(0, hash), target.slice(hash)];
}

/**
 * A guide's link as the site serves it: `webhooks.md#topics` →
 * `/guides/webhooks#topics`, `index.md` → `/guides`. A same-page `#anchor`
 * stays, unless `from` names the guide it was written in (for text lifted
 * onto another page). Absolute links are kept.
 * @param {string} target
 * @param {string} [from] the slug of the guide the link was written in
 */
export function guideLink(target, from) {
  if (isAbsolute(target)) return target;
  const [path, anchor] = splitAnchor(target);
  if (path === '')
    return from === undefined ? anchor : guideRoute(from) + anchor;
  const guide = /^([a-z0-9-]+)\.md$/.exec(path);
  if (!guide) {
    throw new Error(
      `"${target}" is not a link to a guide (link another guide as "<slug>.md")`,
    );
  }
  return guideRoute(guide[1] ?? '') + anchor;
}

/**
 * A package README's link as the site serves it: another package's folder →
 * its page, a guide → the guide, anything else in the repo → GitHub.
 * @param {string} target
 * @param {string} folder the README's package folder
 */
export function packageLink(target, folder) {
  if (isAbsolute(target) || target.startsWith('#')) return target;
  const [path, anchor] = splitAnchor(target);
  const file = posix.normalize(posix.join('packages', folder, path));
  const pkg = /^packages\/([a-z0-9-]+)\/?$/.exec(file);
  if (pkg) return `/packages/${pkg[1] ?? ''}${anchor}`;
  const guide = /^docs\/guides\/([a-z0-9-]+)\.md$/.exec(file);
  if (guide) return guideRoute(guide[1] ?? '') + anchor;
  if (file.startsWith('../')) {
    throw new Error(`"${target}" in packages/${folder} leaves the repository`);
  }
  return `${REPO_URL}/blob/main/${file}${anchor}`;
}

/**
 * The body without its `# <title>` line and the blank lines after it.
 * @param {string} body
 * @param {string} title
 * @param {string} file for the error
 */
function withoutTitle(body, title, file) {
  const lines = body.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (lines[first] !== `# ${title}`) {
    throw new Error(`${file}: the first line of text must be "# ${title}"`);
  }
  let next = first + 1;
  while (next < lines.length && (lines[next] ?? '').trim() === '') next += 1;
  return lines.slice(next).join('\n');
}

/**
 * A page of the site: front matter, the generated-file notice, the body.
 * @param {PageMeta} meta
 * @param {string} source the file it is generated from
 * @param {string} body MDX
 */
function page({ title, description }, source, body) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    `{/* Generated by \`npm run docs:sync\` from ${source}: edit that, not this file. */}`,
    '',
    body.trim(),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Pages

/**
 * A guide's page. The errors guide also links each code of its generated
 * table to the code's page.
 * @param {Guide} guide a guide without problems (guideSetProblems)
 * @param {ReadonlySet<string>} [codes] the problem codes that have a page
 * @returns {string}
 */
export function guidePage(guide, codes = new Set()) {
  const meta = guide.frontMatter;
  if (!meta || guide.problems.length > 0) {
    throw new Error(`docs/guides/${guide.file}: ${guide.problems.join('; ')}`);
  }
  let body = withoutTitle(guide.body, meta.title, `docs/guides/${guide.file}`);
  if (codes.size > 0) body = linkCodes(body, codes);
  body = mapProse(body, (prose) =>
    escapeMdx(rewriteLinks(prose, (target) => guideLink(target))),
  );
  return page(meta, `docs/guides/${guide.file}`, body);
}

/**
 * The rows of a table that start with a code that has a page link it.
 * @param {string} body
 * @param {ReadonlySet<string>} codes
 */
function linkCodes(body, codes) {
  return body
    .split('\n')
    .map((line) =>
      line.replace(
        /^\| `([A-Z][A-Z0-9_]*)`( *)\|/,
        (row, /** @type {string} */ code, /** @type {string} */ pad) =>
          codes.has(code) ? `| [\`${code}\`](${errorRoute(code)})${pad}|` : row,
      ),
    )
    .join('\n');
}

/**
 * The hand-written "what to do" of each code in errors.md: the text under
 * its `### \`CODE\`` heading, before the generated block.
 * @param {string} source errors.md
 * @returns {Map<string, string>}
 */
export function codeExplanations(source) {
  const start = source.indexOf(GENERATED_START);
  const lines = (start === -1 ? source : source.slice(0, start)).split('\n');
  const fenced = fencedLines(lines);
  /** @type {Map<string, string>} */
  const explanations = new Map();
  /** @type {string | undefined} */
  let code;
  /** @type {string[]} */
  let text = [];
  const flush = () => {
    if (code !== undefined) explanations.set(code, text.join('\n').trim());
  };
  for (const [index, line] of lines.entries()) {
    if (!fenced.has(index) && /^#{1,6}\s/.test(line)) {
      flush();
      code = /^###\s+`([A-Za-z_]+)`\s*$/.exec(line)?.[1];
      text = [];
    } else if (code !== undefined) {
      text.push(line);
    }
  }
  flush();
  return explanations;
}

/**
 * The site path of an Admin API operation's reference page (`GET /orders` →
 * `/api-reference/admin/orders/list-orders`): Mintlify's
 * `<directory>/<tag>/<summary>`, slugged like a GitHub heading.
 * @param {OpenApiDocument} document
 * @param {string} operation `METHOD /path` relative to /apps/2026-10
 * @param {string} directory
 */
export function operationRoute(document, operation, directory) {
  const [method = '', path = ''] = operation.split(' ');
  const item = document.paths?.[`${ADMIN_PREFIX}${path}`];
  const entry =
    /** @type {{ tags?: string[], summary?: string } | undefined} */ (
      item?.[method.toLowerCase()]
    );
  const tag = entry?.tags?.[0];
  if (!tag || !entry.summary) {
    throw new Error(`${operation}: no tag or summary in the OpenAPI document`);
  }
  return `/${directory}/${anchorOf(tag)}/${anchorOf(entry.summary)}`;
}

const NO_EXPLANATION =
  "Read the answer's `fix`: one sentence that says what to do. Act on the `code`, never on `title` or `detail`.";

/**
 * One page per problem code of the OpenAPI document, keyed by its file in
 * site/ (`errors/<kebab-code>.mdx`), sorted by code.
 * @param {OpenApiDocument} document
 * @param {string} errorsGuide docs/guides/errors.md
 * @param {string} directory the API reference's directory for the document
 * @returns {Map<string, string>}
 */
export function errorPages(document, errorsGuide, directory) {
  const { codes, operations } = problemCodes(document);
  const explanations = codeExplanations(errorsGuide);
  /** @type {Map<string, string>} */
  const pages = new Map();
  for (const code of [...codes.keys()].sort()) {
    const use = codes.get(code);
    if (!use) continue;
    const http = [...use.statuses].sort((a, b) => a - b).join(', ');
    const answeredBy = [...use.operations].sort();
    const everyOperation = use.operations.size === operations;
    const from = everyOperation
      ? 'every operation of the Admin API'
      : answeredBy.length === 1
        ? (answeredBy[0] ?? '')
        : `${String(answeredBy.length)} operations of the Admin API`;
    const explanation = mapProse(
      explanations.get(code) ?? NO_EXPLANATION,
      (prose) =>
        escapeMdx(rewriteLinks(prose, (target) => guideLink(target, 'errors'))),
    );
    const body = [
      `Its problem \`type\`: \`${PROBLEM_TYPE_BASE}${kebab(code)}\`.`,
      '',
      '## What to do',
      '',
      explanation,
      '',
      '## Answered by',
      '',
      everyOperation
        ? `Every operation of the Admin API, with HTTP ${http}.`
        : [
            `HTTP ${http}, from:`,
            '',
            ...answeredBy.map(
              (operation) =>
                `- [\`${operation}\`](${operationRoute(document, operation, directory)})`,
            ),
          ].join('\n'),
      '',
      'The shape of every problem, and how `@tassyir/app` reports it: [Errors](/guides/errors).',
    ].join('\n');
    pages.set(
      `errors/${kebab(code)}.mdx`,
      page(
        { title: code, description: `HTTP ${http}, from ${from}.` },
        'docs/guides/errors.md and the OpenAPI document',
        body,
      ),
    );
  }
  return pages;
}

/**
 * A public package's page, from its README (which starts with `# <name>`).
 * @param {PackageSource} pkg
 * @returns {string}
 */
export function packagePage({ folder, name, description, readme }) {
  const source = `packages/${folder}/README.md`;
  const body = mapProse(withoutTitle(readme, name, source), (prose) =>
    escapeMdx(rewriteLinks(prose, (target) => packageLink(target, folder))),
  );
  return page({ title: name, description }, source, body);
}

// ---------------------------------------------------------------------------
// docs.json

/**
 * The site's navigation: the guides in front-matter `order` (then the
 * hand-written pages), the API reference from each OpenAPI document, every
 * error code, every public package.
 * @param {{ guides: Guide[], codes: string[], packages: PackageSource[] }} sources
 */
export function navigation({ guides, codes, packages }) {
  const ordered = [...guides].sort(
    (a, b) => (a.frontMatter?.order ?? 0) - (b.frontMatter?.order ?? 0),
  );
  return {
    tabs: [
      {
        tab: 'Guides',
        icon: 'book-open',
        groups: [
          {
            group: 'Guides',
            pages: ordered.map((guide) => `guides/${guide.slug}`),
          },
          ...HAND_WRITTEN_GROUPS,
        ],
      },
      {
        tab: 'API reference',
        icon: 'square-terminal',
        groups: OPENAPI_SOURCES.map(({ source, group, directory }) => ({
          group,
          openapi: { source: `/openapi/${posix.basename(source)}`, directory },
        })),
      },
      {
        tab: 'Errors',
        icon: 'triangle-alert',
        groups: [
          {
            group: 'Error codes',
            pages: [...codes].sort().map((code) => `errors/${kebab(code)}`),
          },
        ],
      },
      {
        tab: 'Packages',
        icon: 'package',
        groups: [
          {
            group: 'Packages',
            pages: [...packages]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(({ folder }) => `packages/${folder}`),
          },
        ],
      },
    ],
  };
}

/**
 * Every page path a navigation lists (OpenAPI groups list none).
 * @param {unknown} node
 * @returns {string[]}
 */
export function navigationPages(node) {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(navigationPages);
  if (typeof node !== 'object' || node === null) return [];
  const { pages, groups, tabs } = /** @type {Record<string, unknown>} */ (node);
  return [pages, groups, tabs].flatMap(navigationPages);
}

/**
 * @typedef {{
 *   colors: Readonly<Record<'light' | 'dark', Readonly<Record<string, string>>>>,
 *   fonts: { readonly sans: string },
 * }} Tokens
 */

/**
 * docs.json's colours, background and face from @tassyir/ui's tokens: ink
 * on paper. `primary` (emphasis in light mode) and `dark` (buttons) are the
 * light theme's ink, `light` (emphasis in dark mode) the dark theme's; the
 * background is each theme's paper; the face is the first of the sans stack.
 * @param {Tokens} tokens
 */
export function themeSettings({ colors, fonts }) {
  /** @param {'light' | 'dark'} theme @param {string} token */
  const color = (theme, token) => {
    const value = colors[theme][token];
    if (value === undefined) throw new Error(`no ${theme} token "${token}"`);
    return hexOf(value);
  };
  const family = /^"([^"]+)"/.exec(fonts.sans)?.[1];
  if (!family) throw new Error(`no quoted family first in "${fonts.sans}"`);
  return {
    colors: {
      primary: color('light', 'ink'),
      light: color('dark', 'ink'),
      dark: color('light', 'ink'),
    },
    background: {
      color: { light: color('light', 'paper'), dark: color('dark', 'paper') },
    },
    fonts: { family },
  };
}

/**
 * A CSS colour as `#RRGGBB`: a hex colour, or `oklch(L C H)` converted
 * through OKLab to sRGB (Mintlify takes hex only).
 * @param {string} css
 * @returns {string}
 */
export function hexOf(css) {
  const value = css.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) {
    return `#${short
      .slice(1)
      .map((digit) => `${digit}${digit}`)
      .join('')}`.toUpperCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  const oklch =
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/i.exec(value);
  if (!oklch) throw new Error(`"${css}" is neither hex nor oklch(L C H)`);
  const lightness = Number(oklch[1]) / (oklch[2] === '%' ? 100 : 1);
  const chroma = Number(oklch[3]);
  const hue = (Number(oklch[4]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map((channel) => {
      const encoded =
        channel <= 0.0031308
          ? 12.92 * channel
          : 1.055 * channel ** (1 / 2.4) - 0.055;
      const byte = Math.round(Math.min(1, Math.max(0, encoded)) * 255);
      return byte.toString(16).padStart(2, '0');
    })
    .join('')}`.toUpperCase();
}
