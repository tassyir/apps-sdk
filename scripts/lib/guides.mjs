// The pure parts of the developer guides' checks (docs/guides), proved by
// guides.test.mjs. scripts/guides.test.mjs runs them on the guides
// themselves, and scripts/check-guides.mjs typechecks the guides' code
// against the packed packages.
//
// A guide is `docs/guides/<slug>.md`: YAML front matter with exactly
// `title`, `description` and `order`, then a body whose first line of text
// is `# <title>`. The slug is the file name and never changes (the docs site
// publishes it). docs/guides/README.md holds the authoring rules.

/** @typedef {{ title: string, description: string, order: number }} FrontMatter */
/**
 * @typedef {{
 *   slug: string,
 *   file: string,
 *   frontMatter: FrontMatter | undefined,
 *   body: string,
 *   bodyLine: number,
 *   problems: string[],
 * }} Guide
 */
/** @typedef {{ lang: string, meta: string, code: string, line: number }} CodeBlock */

export const GUIDE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FRONT_MATTER_KEYS = ['title', 'description', 'order'];

/**
 * Splits a guide into its front matter and body.
 * @param {string} slug
 * @param {string} source
 * @returns {Guide}
 */
export function parseGuide(slug, source) {
  const file = `${slug}.md`;
  /** @type {string[]} */
  const problems = [];
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) {
    return {
      slug,
      file,
      frontMatter: undefined,
      body: source,
      bodyLine: 1,
      problems: [`${file}: starts without front matter (---)`],
    };
  }
  const header = match[1] ?? '';
  /** @type {Record<string, string>} */
  const values = {};
  for (const line of header.split('\n')) {
    const field = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!field) {
      problems.push(`${file}: front matter line "${line}" is not "key: value"`);
      continue;
    }
    const [, key = '', raw = ''] = field;
    if (!FRONT_MATTER_KEYS.includes(key)) {
      problems.push(
        `${file}: front matter key "${key}" is not one of ${FRONT_MATTER_KEYS.join(', ')}`,
      );
      continue;
    }
    if (key in values) problems.push(`${file}: front matter repeats "${key}"`);
    values[key] = unquote(raw.trim());
  }
  const title = values['title'] ?? '';
  const description = values['description'] ?? '';
  const order = Number(values['order']);
  if (title === '') problems.push(`${file}: front matter has no title`);
  if (description === '') {
    problems.push(`${file}: front matter has no description`);
  } else if (!/\.$/.test(description) || description.length > 200) {
    problems.push(
      `${file}: the description is one sentence of at most 200 characters, ending with "."`,
    );
  }
  if (!Number.isInteger(order) || order < 0) {
    problems.push(`${file}: front matter "order" is not a whole number`);
  }
  const body = source.slice(match[0].length);
  const bodyLine = header.split('\n').length + 3;
  const firstLine = body.split('\n').find((line) => line.trim() !== '') ?? '';
  if (title !== '' && firstLine !== `# ${title}`) {
    problems.push(`${file}: the body must start with "# ${title}"`);
  }
  return {
    slug,
    file,
    frontMatter: { title, description, order },
    body,
    bodyLine,
    problems,
  };
}

/** @param {string} value */
function unquote(value) {
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  return quoted ? (quoted[1] ?? '') : value;
}

/**
 * What is wrong with the set of guides as a whole: slugs, unique orders and
 * titles, and every guide's own problems.
 * @param {Guide[]} guides
 * @returns {string[]}
 */
export function guideSetProblems(guides) {
  const problems = guides.flatMap((guide) => guide.problems);
  /** @type {Map<number, string>} */
  const orders = new Map();
  /** @type {Map<string, string>} */
  const titles = new Map();
  for (const guide of guides) {
    if (!GUIDE_SLUG.test(guide.slug)) {
      problems.push(
        `${guide.file}: the file name (the slug) is lowercase words joined by "-"`,
      );
    }
    if (!guide.frontMatter) continue;
    const { order, title } = guide.frontMatter;
    const sameOrder = orders.get(order);
    if (sameOrder !== undefined) {
      problems.push(`${guide.file}: order ${order} is also ${sameOrder}'s`);
    }
    orders.set(order, guide.file);
    const sameTitle = titles.get(title);
    if (sameTitle !== undefined) {
      problems.push(`${guide.file}: title "${title}" is also ${sameTitle}'s`);
    }
    titles.set(title, guide.file);
  }
  return problems;
}

/**
 * The fenced code blocks of a Markdown body (``` fences only), with the
 * line of their first code line in the file.
 * @param {string} body
 * @param {number} [firstLine] the file line of the body's first line
 * @returns {CodeBlock[]}
 */
export function codeBlocks(body, firstLine = 1) {
  /** @type {CodeBlock[]} */
  const blocks = [];
  const lines = body.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const open = /^```(\S*)\s*(.*)$/.exec(lines[index] ?? '');
    if (!open) continue;
    const start = index + 1;
    let end = start;
    while (end < lines.length && lines[end] !== '```') end += 1;
    if (end === lines.length) {
      throw new Error(
        `a code fence opened at line ${firstLine + index} never closes`,
      );
    }
    blocks.push({
      lang: open[1] ?? '',
      meta: (open[2] ?? '').trim(),
      code: lines.slice(start, end).join('\n'),
      line: firstLine + start,
    });
    index = end;
  }
  return blocks;
}

/**
 * The body without its fenced code blocks and inline code spans, the same
 * number of lines (code lines are left empty): what links and headings are
 * read from.
 * @param {string} body
 * @returns {string}
 */
export function proseOf(body) {
  let inFence = false;
  return body
    .split('\n')
    .map((line) => {
      if (/^```/.test(line)) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : line.replace(/`[^`]*`/g, '``');
    })
    .join('\n');
}

/**
 * The anchors GitHub (and most Markdown sites) give the body's headings:
 * lowercase, punctuation dropped, spaces to "-", repeats numbered.
 * @param {string} body
 * @returns {Set<string>}
 */
export function headingAnchors(body) {
  /** @type {Set<string>} */
  const anchors = new Set();
  /** @type {Map<string, number>} */
  const seen = new Map();
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!heading) continue;
    const base = anchorOf(heading[1] ?? '');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

/**
 * GitHub's heading slug: the text without Markdown marks, lowercased, every
 * character but letters, digits, "-", "_" and spaces dropped, spaces to "-".
 * @param {string} text
 * @returns {string}
 */
export function anchorOf(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Private repositories and planning documents a public page never links to. */
const PRIVATE_LINK = /github\.com\/tassyir\/(?!apps-sdk\b)/i;

/**
 * Every link of every guide must work on GitHub and on the docs site: a
 * relative link names another guide by its file (`webhooks.md`, with an
 * optional `#anchor` that exists there) or an anchor of the same page; an
 * absolute link is https and never points at a private repository.
 * @param {Guide[]} guides
 * @returns {string[]}
 */
export function linkProblems(guides) {
  /** @type {Map<string, Set<string>>} */
  const anchors = new Map(
    guides.map((guide) => [guide.file, headingAnchors(guide.body)]),
  );
  /** @type {string[]} */
  const problems = [];
  for (const guide of guides) {
    const prose = proseOf(guide.body);
    const lines = prose.split('\n');
    for (const [index, line] of lines.entries()) {
      const where = `${guide.file}:${guide.bodyLine + index}`;
      for (const match of line.matchAll(/\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1] ?? '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
          if (!target.startsWith('https://') && !target.startsWith('mailto:')) {
            problems.push(`${where}: "${target}" is not an https link`);
          } else if (PRIVATE_LINK.test(target)) {
            problems.push(`${where}: "${target}" is a private repository`);
          }
          continue;
        }
        const [path = '', anchor] = target.split('#');
        const file = path === '' ? guide.file : path;
        const known = anchors.get(file);
        if (!known) {
          problems.push(
            `${where}: "${target}" is not a guide (link another guide as "<slug>.md")`,
          );
        } else if (anchor !== undefined && !known.has(anchor)) {
          problems.push(
            `${where}: "${target}": ${file} has no heading #${anchor}`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * What a public guide never names: Tassyir's own code, tables, keys,
 * environment variables, infrastructure and planning. The guides describe
 * the contract an app sees, never how Tassyir implements it.
 */
export const LEAK_PATTERNS = [
  {
    pattern: /\bsrc\/(?:app-platform|core|orders|catalog|tenancy)\b/,
    what: 'a backend source path',
  },
  {
    pattern: /\.(?:service|controller|guard|module|spec)\.ts\b/,
    what: 'a backend source file',
  },
  {
    pattern:
      /\b[A-Z][A-Za-z]*(?:Service|Controller|Cron|Guard|Module|Interceptor|Middleware|Processor|Recorder|Repository)\b/,
    what: 'a backend class',
  },
  { pattern: /\bprisma\b/i, what: 'the ORM' },
  {
    pattern: /\b(?:BullMQ|Bull Board|CapRover|Sentry|PostHog|Axiom|Neon)\b/i,
    what: 'infrastructure',
  },
  { pattern: /\bRedis\b/i, what: 'infrastructure' },
  { pattern: /\bdroplet\b|\bsrv-captain/i, what: 'infrastructure' },
  {
    pattern: /Cloudflare (?:Images|Workers for Platforms|for SaaS)|\bR2\b/,
    what: 'infrastructure',
  },
  {
    pattern: /\b(?:APPS|PUBLIC_API|DATABASE|GLOBAL|BUSINESSES)_[A-Z0-9_]+\b/,
    what: 'an environment variable',
  },
  {
    pattern:
      /\b(?:THROTTLE_ENFORCE|SSRF_GUARD_MODE|HQ_IMAGE_BUSINESS_IDS|JWT_SECRET|NODE_ENV|APP_ROLE)\b/,
    what: 'an environment variable',
  },
  {
    pattern:
      /\b(?:app_(?:installations|tokens|events|deliveries|versions|credentials|data)|developer_(?:accounts|cli_tokens)|memberships)\b/,
    what: 'a database table',
  },
  { pattern: /\bapps:(?:tok|idem|cli)\b|throttle:g:/, what: 'a cache key' },
  {
    pattern:
      /tassyir\/(?:backend|frontend)\b|APPS_PLATFORM_PLAN|docs\/api\/apps/,
    what: 'a private repository or document',
  },
  { pattern: /\bAP-[BFKS]\d/, what: 'a ticket id' },
];

/**
 * Lines of a guide that name something internal.
 * @param {string} file
 * @param {string} source the whole file
 * @returns {string[]}
 */
export function leakProblems(file, source) {
  /** @type {string[]} */
  const problems = [];
  for (const [index, line] of source.split('\n').entries()) {
    for (const { pattern, what } of LEAK_PATTERNS) {
      const found = pattern.exec(line);
      if (found) {
        problems.push(`${file}:${index + 1}: "${found[0]}" names ${what}`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The error reference (docs/guides/errors.md), generated from the OpenAPI
// document @tassyir/app is typed from.

export const GENERATED_START =
  '<!-- generated:error-reference: npm run guides:errors writes everything up to the end marker -->';
export const GENERATED_END = '<!-- end:error-reference -->';

const ADMIN_PREFIX = '/apps/2026-10';
const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

/**
 * @typedef {{ statuses: Set<number>, operations: Set<string> }} CodeUse
 * @typedef {{
 *   info?: { version?: string },
 *   paths?: Record<string, Record<string, unknown>>,
 *   components?: { responses?: Record<string, unknown> },
 * }} OpenApiDocument
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The enum of a schema's `property`, looked for in the schema and its
 * `allOf` members.
 * @param {unknown} schema
 * @param {string} property
 * @returns {string[]}
 */
function enumOf(schema, property) {
  if (!isRecord(schema)) return [];
  /** @type {string[]} */
  const values = [];
  const properties = schema['properties'];
  if (isRecord(properties)) {
    const field = properties[property];
    if (isRecord(field) && Array.isArray(field['enum'])) {
      values.push(
        ...field['enum'].filter((value) => typeof value === 'string'),
      );
    }
  }
  const allOf = schema['allOf'];
  if (Array.isArray(allOf)) {
    for (const member of allOf) values.push(...enumOf(member, property));
  }
  return values;
}

/**
 * Every answer of every operation, `$ref`s to shared responses resolved.
 * @param {OpenApiDocument} document
 * @returns {{ path: string, method: string, status: number, response: Record<string, unknown> }[]}
 */
function answers(document) {
  const shared = document.components?.responses ?? {};
  /** @type {{ path: string, method: string, status: number, response: Record<string, unknown> }[]} */
  const all = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!isRecord(operation) || !isRecord(operation['responses'])) continue;
      for (const [status, raw] of Object.entries(operation['responses'])) {
        let response = raw;
        if (isRecord(response) && typeof response['$ref'] === 'string') {
          const name = response['$ref'].split('/').pop() ?? '';
          response = shared[name];
        }
        if (!isRecord(response) || !/^\d{3}$/.test(status)) continue;
        all.push({ path, method, status: Number(status), response });
      }
    }
  }
  return all;
}

/**
 * The schema of one content type of an answer.
 * @param {Record<string, unknown>} response
 * @param {string} type
 */
function schemaOf(response, type) {
  const content = response['content'];
  if (!isRecord(content)) return undefined;
  const media = content[type];
  return isRecord(media) ? media['schema'] : undefined;
}

/**
 * The Admin API's problem codes: for each, the HTTP statuses that carry it
 * and the operations (`METHOD /path`, relative to /apps/2026-10) that may
 * answer it.
 * @param {OpenApiDocument} document
 * @returns {{ codes: Map<string, CodeUse>, operations: number }}
 */
export function problemCodes(document) {
  /** @type {Map<string, CodeUse>} */
  const codes = new Map();
  /** @type {Set<string>} */
  const operations = new Set();
  for (const { path, method, status, response } of answers(document)) {
    if (!path.startsWith(`${ADMIN_PREFIX}/`)) continue;
    const operation = `${method.toUpperCase()} ${path.slice(ADMIN_PREFIX.length)}`;
    operations.add(operation);
    for (const code of enumOf(
      schemaOf(response, 'application/problem+json'),
      'code',
    )) {
      const use = codes.get(code) ?? {
        statuses: new Set(),
        operations: new Set(),
      };
      use.statuses.add(status);
      use.operations.add(operation);
      codes.set(code, use);
    }
  }
  return { codes, operations: operations.size };
}

/**
 * The token endpoint's OAuth `error` values, by HTTP status.
 * @param {OpenApiDocument} document
 * @returns {Map<string, Set<number>>}
 */
export function oauthErrors(document) {
  /** @type {Map<string, Set<number>>} */
  const errors = new Map();
  for (const { path, status, response } of answers(document)) {
    if (path !== '/apps/oauth/token') continue;
    for (const error of enumOf(
      schemaOf(response, 'application/json'),
      'error',
    )) {
      const statuses = errors.get(error) ?? new Set();
      statuses.add(status);
      errors.set(error, statuses);
    }
  }
  return errors;
}

/** @param {Set<number>} statuses */
function statusList(statuses) {
  return [...statuses].sort((a, b) => a - b).join(', ');
}

/**
 * @param {Set<string>} operations
 * @param {number} total
 */
function operationList(operations, total) {
  if (operations.size === total) return 'every operation';
  if (operations.size > 6) return `${operations.size} operations`;
  return [...operations]
    .sort()
    .map((operation) => `\`${operation}\``)
    .join(', ');
}

/**
 * The generated part of errors.md, markers included.
 * @param {OpenApiDocument} document
 * @returns {string}
 */
export function renderErrorReference(document) {
  const version = document.info?.version ?? '';
  const { codes, operations } = problemCodes(document);
  const oauth = oauthErrors(document);
  const lines = [
    GENERATED_START,
    '',
    '## Every Admin API code',
    '',
    `Generated from the OpenAPI document of API version \`${version}\` that \`@tassyir/app\` is typed from (${operations} operations under \`/apps/${version}/\`). An operation lists every code it can answer, per status, in that document.`,
    '',
    '| Code | HTTP | Answered by |',
    '| --- | --- | --- |',
    ...[...codes.keys()].sort().map((code) => {
      const use = /** @type {CodeUse} */ (codes.get(code));
      return `| \`${code}\` | ${statusList(use.statuses)} | ${operationList(use.operations, operations)} |`;
    }),
    '',
    '## Token endpoint errors',
    '',
    '`POST /apps/oauth/token` answers OAuth errors, `{ "error": "…", "error_description": "…" }`, never problem+json.',
    '',
    '| `error` | HTTP |',
    '| --- | --- |',
    ...[...oauth.keys()]
      .sort()
      .map(
        (error) =>
          `| \`${error}\` | ${statusList(/** @type {Set<number>} */ (oauth.get(error)))} |`,
      ),
    '',
    GENERATED_END,
  ];
  return lines.join('\n');
}

/**
 * The generated block of a file (markers included), or undefined.
 * @param {string} source
 * @returns {string | undefined}
 */
export function generatedBlock(source) {
  const start = source.indexOf(GENERATED_START);
  const end = source.indexOf(GENERATED_END);
  if (start === -1 || end === -1 || end < start) return undefined;
  return source.slice(start, end + GENERATED_END.length);
}

/**
 * The file with its generated block replaced.
 * @param {string} source
 * @param {string} block
 * @returns {string}
 */
export function withGeneratedBlock(source, block) {
  const current = generatedBlock(source);
  if (current === undefined) {
    throw new Error(`no "${GENERATED_START}" … "${GENERATED_END}" block`);
  }
  return source.replace(current, () => block);
}

/**
 * The codes the hand-written part of errors.md explains (`### \`CODE\``
 * headings before the generated block).
 * @param {string} source
 * @returns {string[]}
 */
export function explainedCodes(source) {
  const start = source.indexOf(GENERATED_START);
  const handWritten = start === -1 ? source : source.slice(0, start);
  return [...handWritten.matchAll(/^###\s+`([A-Za-z_]+)`/gm)].map(
    (match) => match[1] ?? '',
  );
}
