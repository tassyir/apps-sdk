import {
  ALLOWED_HOST_PATTERN,
  BLOCK_DATA_OWNERS,
  BLOCK_DATA_PATTERN,
  DATA_KEY_PATTERN,
  DATA_OWNERS,
  HANDLE_PATTERN,
  HOSTNAME_PATTERN,
  INVISIBLE_CHARACTER,
  MANIFEST_LIMITS,
  PRIVATE_TLDS,
  RESERVED_DOMAINS,
  RESERVED_HANDLES,
  SETTING_COLOR_PATTERN,
  SETTING_KEY_PATTERN,
  SETTING_OPTION_VALUE_PATTERN,
  STYLESHEET_PATTERN,
  TEMPLATE_PATTERN,
} from './manifest-limits.js';
import type { ManifestError, ManifestErrorCode } from './manifest-types.js';

/**
 * One check per kind of value. Each returns the most specific refusal for the
 * value, or null. The zod schema carries the same rules as patterns (for the
 * published JSON Schema); these functions are what decides the message, so
 * an AI agent reading `fix` is told the one thing to change.
 */

export type Problem = Omit<ManifestError, 'path'>;

const problem = (
  code: ManifestErrorCode,
  message: string,
  fix: string,
): Problem => ({ code, message, fix });

const L = MANIFEST_LIMITS;

// ── Shared helpers ──────────────────────────────────────────────────────────

/** A value as an error may echo it: JSON-quoted, at most 60 characters. */
export function quote(value: unknown): string {
  if (typeof value !== 'string') return describeType(value);
  const short = value.length > 60 ? `${value.slice(0, 57)}...` : value;
  return JSON.stringify(short);
}

/** The value's kind in TOML words. */
export function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'missing';
  if (Array.isArray(value)) return 'an array';
  if (value instanceof Date) return 'a date';
  switch (typeof value) {
    case 'string':
      return 'a string';
    case 'number':
    case 'bigint':
      return 'a number';
    case 'boolean':
      return 'a boolean';
    case 'object':
      return 'a table';
    default:
      return 'not data';
  }
}

function codePoint(text: string): string {
  const match = text.match(INVISIBLE_CHARACTER);
  const code = match ? (match[0].codePointAt(0) ?? 0) : 0;
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  // Every index read below is in 0..b.length: the `?? 0` never applies.
  const at = (j: number): number => previous[j] ?? 0;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = at(0);
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = at(j);
      previous[j] = Math.min(
        at(j) + 1,
        at(j - 1) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return at(b.length);
}

/**
 * The closest candidate, if it is close enough to be a typo. Ties go to the
 * earlier candidate, so the answer never depends on anything but the input.
 */
export function closestMatch(
  value: string,
  candidates: readonly string[],
): string | null {
  const probe = value.toLowerCase().replace(/-/g, '_').slice(0, 80);
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = editDistance(
      probe,
      candidate.toLowerCase().replace(/-/g, '_'),
    );
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  const limit = Math.min(3, Math.floor(probe.length / 2));
  return best !== null && bestDistance <= limit ? best : null;
}

// ── Display text (name, scope reasons) ──────────────────────────────────────

interface TextRule {
  code: ManifestErrorCode;
  min: number;
  max: number;
  /** What the text is for, ending the fix sentence. */
  purpose: string;
}

function textProblem(
  value: string,
  path: string,
  rule: TextRule,
): Problem | null {
  if (value.length === 0) {
    return problem(
      rule.code,
      `\`${path}\` is empty.`,
      `Write ${rule.purpose}.`,
    );
  }
  if (INVISIBLE_CHARACTER.test(value)) {
    const where = codePoint(value);
    return problem(
      rule.code,
      `\`${path}\` holds an invisible, control or line-break character (${where}).`,
      `Remove the ${where} character from \`${path}\` and keep the text on one line.`,
    );
  }
  if (/^\s|\s$/.test(value)) {
    return problem(
      rule.code,
      `\`${path}\` starts or ends with a space.`,
      `Remove the spaces around the text of \`${path}\`.`,
    );
  }
  if (value.length < rule.min) {
    return problem(
      rule.code,
      `\`${path}\` is ${value.length} characters long; the minimum is ${rule.min}.`,
      `Write ${rule.purpose}, at least ${rule.min} characters.`,
    );
  }
  if (value.length > rule.max) {
    return problem(
      rule.code,
      `\`${path}\` is ${value.length} characters long; the limit is ${rule.max}.`,
      `Shorten \`${path}\` to ${rule.max} characters or fewer.`,
    );
  }
  return null;
}

export function nameProblem(value: string, path: string): Problem | null {
  return textProblem(value, path, {
    code: 'MANIFEST_NAME_INVALID',
    min: 1,
    max: L.nameMaxLength,
    purpose: 'the app\'s display name, e.g. name = "Review Requests"',
  });
}

/**
 * One language of a `{ ar, en }` label shown to merchants (a data
 * definition's, a block's name, a setting's or an option's, an admin
 * action's): the `name` text rules.
 */
export function labelProblem(
  value: string,
  path: string,
  code: ManifestErrorCode,
): Problem | null {
  const language = path.endsWith('.ar') ? 'Arabic' : 'English';
  return textProblem(value, path, {
    code,
    min: 1,
    max: L.labelMaxLength,
    purpose: `the ${language} text merchants read, ${L.labelMaxLength} characters at most`,
  });
}

export function scopeReasonProblem(
  value: string,
  path: string,
  scope: string,
): Problem | null {
  return textProblem(value, path, {
    code: 'MANIFEST_SCOPE_REASON_INVALID',
    min: L.scopeReasonMinLength,
    max: L.scopeReasonMaxLength,
    purpose: `one sentence telling the merchant why the app needs \`${scope}\`, e.g. "Find delivered orders to ask for a review"`,
  });
}

// ── Handles ─────────────────────────────────────────────────────────────────

function slugOf(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, L.handleMaxLength)
    .replace(/-+$/, '');
}

function isHandle(value: string): boolean {
  return (
    value.length >= L.handleMinLength &&
    value.length <= L.handleMaxLength &&
    HANDLE_PATTERN.test(value)
  );
}

/**
 * The app's handle (also a DNS label: `{handle}.tassyir-apps.com`), a
 * storefront block's or an admin action's.
 */
export function handleProblem(
  value: string,
  path: string,
  kind: 'app' | 'block' | 'action',
): Problem | null {
  const code: ManifestErrorCode =
    kind === 'app'
      ? 'MANIFEST_HANDLE_INVALID'
      : kind === 'block'
        ? 'MANIFEST_BLOCK_HANDLE_INVALID'
        : 'MANIFEST_ACTION_HANDLE_INVALID';
  if (!isHandle(value)) {
    const slug = slugOf(value);
    const suggestion = isHandle(slug)
      ? ` e.g. "${slug}"`
      : ' e.g. "review-requests"';
    return problem(
      code,
      `\`${path}\` is ${quote(value)}; a handle is ${L.handleMinLength} to ${L.handleMaxLength} lowercase letters, digits and single hyphens, starting and ending with a letter or digit.`,
      `Set \`${path}\` to a handle of that form,${suggestion}.`,
    );
  }
  if (kind === 'app' && RESERVED_HANDLES.includes(value)) {
    return problem(
      'MANIFEST_HANDLE_RESERVED',
      `\`${path}\` is ${quote(value)}, which Tassyir reserves.`,
      `Choose another handle, e.g. "${value}-app" or one naming what the app does.`,
    );
  }
  return null;
}

// ── Hostnames ───────────────────────────────────────────────────────────────

/** An IPv6 literal, bracketed or not. */
function looksLikeIpv6(value: string): boolean {
  return value.startsWith('[') || (value.match(/:/g) ?? []).length >= 2;
}

/**
 * A dotted name whose last label is a number: an IPv4 address in one of its
 * spellings (`127.0.0.1`, `0x7f.1`), never a public hostname (no top-level
 * domain is numeric).
 */
function endsNumeric(host: string): boolean {
  const last = host.split('.').pop() ?? '';
  return /^(?:0x[0-9a-f]*|[0-9]+)$/i.test(last);
}

function reservedDomainOf(host: string): string | null {
  return (
    RESERVED_DOMAINS.find(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    ) ?? null
  );
}

/**
 * Why a syntactically valid hostname may not be used, or null: an IP
 * address, a name that never reaches the public internet, or Tassyir's own.
 */
function forbiddenHostReason(host: string): string | null {
  if (endsNumeric(host)) return 'an IP address';
  const tld = host.split('.').pop() ?? '';
  if (PRIVATE_TLDS.includes(tld)) return 'a private or reserved name';
  const reserved = reservedDomainOf(host);
  if (reserved) return `on Tassyir's own domain ${reserved}`;
  return null;
}

/** An `allowed_hosts` entry (Tassyir Hosting's egress allowlist). */
export function allowedHostProblem(
  value: string,
  path: string,
): Problem | null {
  const fixTo = (example: string) =>
    `Write only the hostname in \`${path}\`, e.g. "${example}".`;
  if (value.includes('://')) {
    // `value` holds "://", so both pieces exist.
    const host = (
      (value.split('://')[1] ?? '').split(/[/:?#]/)[0] ?? ''
    ).toLowerCase();
    return problem(
      'MANIFEST_HOST_INVALID',
      `\`${path}\` is a URL; \`allowed_hosts\` lists hostnames.`,
      fixTo(host || 'api.example.com'),
    );
  }
  if (looksLikeIpv6(value) || endsNumeric(value)) {
    return problem(
      'MANIFEST_HOST_NOT_ALLOWED',
      `\`${path}\` is ${quote(value)}, an IP address; hosted apps reach the internet by name only.`,
      `Replace \`${path}\` with the service's hostname, or remove it.`,
    );
  }
  if (/[/?#]/.test(value)) {
    return problem(
      'MANIFEST_HOST_INVALID',
      `\`${path}\` holds a path; \`allowed_hosts\` lists hostnames.`,
      fixTo(value.split(/[/?#]/)[0] || 'api.example.com'),
    );
  }
  if (value.includes(':')) {
    return problem(
      'MANIFEST_HOST_INVALID',
      `\`${path}\` names a port; hosted apps call HTTPS on port 443 only.`,
      fixTo(value.split(':')[0] || 'api.example.com'),
    );
  }
  if (value !== value.toLowerCase()) {
    return problem(
      'MANIFEST_HOST_INVALID',
      `\`${path}\` holds capital letters.`,
      `Write \`${path}\` in lowercase: "${value.toLowerCase()}".`,
    );
  }
  if (value.endsWith('.')) {
    return problem(
      'MANIFEST_HOST_INVALID',
      `\`${path}\` ends with a dot.`,
      fixTo(value.replace(/\.+$/, '') || 'api.example.com'),
    );
  }
  if (PRIVATE_TLDS.includes(value.replace(/^\*\./, ''))) {
    return problem(
      'MANIFEST_HOST_NOT_ALLOWED',
      `\`${path}\` is ${quote(value)}, a private or reserved name.`,
      `Remove \`${path}\`; list only public hostnames the app calls.`,
    );
  }
  if (value.includes('*') && !/^\*\.[^*]+$/.test(value)) {
    return problem(
      'MANIFEST_HOST_INVALID',
      `\`${path}\` is ${quote(value)}; a wildcard may only be the whole first label.`,
      `Write the wildcard as "*.example.com" (one leading "*." label), or list each hostname.`,
    );
  }
  if (value.length > L.hostMaxLength || !ALLOWED_HOST_PATTERN.test(value)) {
    const bare = value.replace(/^\*\./, '');
    const twoLabels = HOSTNAME_PATTERN.test(bare) || bare.includes('.');
    return problem(
      'MANIFEST_HOST_INVALID',
      twoLabels
        ? `\`${path}\` is ${quote(value)}, not a hostname: labels of lowercase letters, digits and hyphens (not at either end), ${L.hostMaxLength} characters at most.`
        : `\`${path}\` is ${quote(value)}; a hostname needs a domain of at least two labels${value.startsWith('*.') ? ' after the wildcard' : ''}.`,
      value.startsWith('*.') && !twoLabels
        ? `Put the wildcard over a whole domain in \`${path}\`, e.g. "*.example.com".`
        : fixTo('api.example.com'),
    );
  }
  const reason = forbiddenHostReason(value.replace(/^\*\./, ''));
  if (reason) {
    const tassyir = reason.startsWith("on Tassyir's");
    return problem(
      'MANIFEST_HOST_NOT_ALLOWED',
      `\`${path}\` is ${quote(value)}, ${reason}.`,
      tassyir
        ? `Remove \`${path}\`; a hosted app calls Tassyir through ctx.props.TASSYIR (the Admin API), not through the network.`
        : `Remove \`${path}\`; list only public hostnames the app calls.`,
    );
  }
  return null;
}

// ── URLs and paths ──────────────────────────────────────────────────────────

const SEGMENT = /^(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%[0-9A-Fa-f]{2})+$/;

/** Why a path (starting with "/") is not acceptable, or null. */
function pathReason(path: string, allowTrailingSlash: boolean): string | null {
  if (path === '/') return allowTrailingSlash ? null : 'ends with "/"';
  const segments = path.slice(1).split('/');
  for (const [i, segment] of segments.entries()) {
    if (segment === '') {
      if (i === segments.length - 1) {
        if (!allowTrailingSlash) return 'ends with "/"';
        continue;
      }
      return 'holds an empty segment ("//")';
    }
    if (!SEGMENT.test(segment)) {
      return 'holds a character a URL path cannot carry unencoded';
    }
    const decodedDots = segment.replace(/%2e/gi, '.');
    if (decodedDots === '.' || decodedDots === '..') {
      return 'holds a "." or ".." segment';
    }
    if (/%(?:2f|5c|00)/i.test(segment)) {
      return 'holds an encoded slash, backslash or null character';
    }
  }
  return null;
}

export interface HttpsUrlRule {
  /** Whether the URL may end with "/" (not a base URL). */
  trailingSlash: boolean;
  /** The example the fix offers. */
  example: string;
}

/** An absolute URL of an external app (base URL, callback, webhook). */
export function httpsUrlProblem(
  value: string,
  path: string,
  rule: HttpsUrlRule,
): Problem | null {
  const invalid = (what: string, fix: string) =>
    problem('MANIFEST_URL_INVALID', `\`${path}\` ${what}.`, fix);
  const fixTo = `Set \`${path}\` to an absolute https URL such as "${rule.example}".`;
  if (value.length > L.urlMaxLength) {
    return invalid(
      `is ${value.length} characters long; the limit is ${L.urlMaxLength}`,
      `Shorten \`${path}\` to ${L.urlMaxLength} characters or fewer.`,
    );
  }
  if (/^http:\/\//i.test(value)) {
    return invalid(
      'uses http',
      `Serve the endpoint over HTTPS and write \`${path}\` as "https://…".`,
    );
  }
  if (!value.startsWith('https://')) {
    return invalid('is not an absolute URL starting with "https://"', fixTo);
  }
  if (/[\s\\]/.test(value)) {
    return invalid('holds a space or a backslash', fixTo);
  }
  if (value.includes('?') || value.includes('#')) {
    return invalid(
      'holds a query string or a fragment',
      `Remove everything from "?" or "#" in \`${path}\`; Tassyir calls the URL exactly as written.`,
    );
  }
  const rest = value.slice('https://'.length);
  const slash = rest.indexOf('/');
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const urlPath = slash === -1 ? '' : rest.slice(slash);
  if (authority.includes('@')) {
    return invalid(
      'holds a user name or password',
      `Remove the credentials from \`${path}\`; Tassyir signs its calls instead.`,
    );
  }
  if (looksLikeIpv6(authority) || endsNumeric(authority.split(':')[0] ?? '')) {
    return problem(
      'MANIFEST_URL_HOST_NOT_ALLOWED',
      `\`${path}\` points at an IP address.`,
      `Use a public hostname with a valid certificate in \`${path}\`.`,
    );
  }
  if (authority.includes(':')) {
    return invalid(
      'names a port',
      `Remove the port from \`${path}\`; Tassyir calls HTTPS on port 443 only.`,
    );
  }
  if (authority !== authority.toLowerCase()) {
    return invalid(
      'has capital letters in its hostname',
      `Write the hostname of \`${path}\` in lowercase: "https://${authority.toLowerCase()}${urlPath}".`,
    );
  }
  if (PRIVATE_TLDS.includes(authority)) {
    return problem(
      'MANIFEST_URL_HOST_NOT_ALLOWED',
      `\`${path}\` points at ${quote(authority)}, a private or reserved name.`,
      `Use a public hostname with a valid certificate in \`${path}\`.`,
    );
  }
  if (authority.length > L.hostMaxLength || !HOSTNAME_PATTERN.test(authority)) {
    return invalid(`has ${quote(authority)} as its hostname`, fixTo);
  }
  const reason = forbiddenHostReason(authority);
  if (reason) {
    return problem(
      'MANIFEST_URL_HOST_NOT_ALLOWED',
      `\`${path}\` points at ${quote(authority)}, ${reason}.`,
      reason.startsWith("on Tassyir's")
        ? `Serve the app from a domain you own; Tassyir's domains are not available to apps (choose hosting.mode = "tassyir" to be hosted by Tassyir).`
        : `Use a public hostname with a valid certificate in \`${path}\`.`,
    );
  }
  if (urlPath !== '') {
    const why = pathReason(urlPath, rule.trailingSlash);
    if (why) {
      return invalid(
        `has a path that ${why}`,
        why === 'ends with "/"'
          ? `Remove the trailing "/" from \`${path}\`.`
          : fixTo,
      );
    }
  }
  return null;
}

/** A path on the app's own origin (`admin.page`, a relative webhook `uri`). */
export function relativePathProblem(
  value: string,
  path: string,
  example: string,
): Problem | null {
  const invalid = (what: string, fix?: string) =>
    problem(
      'MANIFEST_PATH_INVALID',
      `\`${path}\` ${what}.`,
      fix ?? `Set \`${path}\` to a path starting with "/", e.g. "${example}".`,
    );
  if (value.length > L.pathMaxLength) {
    return invalid(
      `is ${value.length} characters long; the limit is ${L.pathMaxLength}`,
      `Shorten \`${path}\` to ${L.pathMaxLength} characters or fewer.`,
    );
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return invalid("is a URL, not a path on the app's own origin");
  }
  if (!value.startsWith('/')) return invalid('does not start with "/"');
  if (value.startsWith('//')) {
    return invalid('starts with "//", which browsers read as another host');
  }
  if (/[\s\\]/.test(value)) return invalid('holds a space or a backslash');
  if (value.includes('?') || value.includes('#')) {
    return invalid(
      'holds a query string or a fragment',
      `Remove everything from "?" or "#" in \`${path}\`.`,
    );
  }
  const why = pathReason(value, true);
  return why ? invalid(why) : null;
}

// ── App data, storefront blocks ─────────────────────────────────────────────

export function dataKeyProblem(value: string, path: string): Problem | null {
  if (DATA_KEY_PATTERN.test(value)) return null;
  const suggestion = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, L.dataKeyMaxLength);
  return problem(
    'MANIFEST_DATA_KEY_INVALID',
    `\`${path}\` is ${quote(value)}; a key is 1 to ${L.dataKeyMaxLength} lowercase letters, digits and underscores, starting with a letter.`,
    `Set \`${path}\` to a key of that form, e.g. "${suggestion || 'rating'}".`,
  );
}

export function templateProblem(value: string, path: string): Problem | null {
  if (value.length <= L.templateMaxLength && TEMPLATE_PATTERN.test(value)) {
    return null;
  }
  return problem(
    'MANIFEST_BLOCK_TEMPLATE_INVALID',
    `\`${path}\` is ${quote(value)}; a template is a \`.liquid\` file of the app bundle, a relative path of lowercase letters, digits, "_" and "-", ${L.templateMaxLength} characters at most.`,
    `Set \`${path}\` to the template's path in the bundle, e.g. "blocks/star-rating.liquid".`,
  );
}

export function stylesheetProblem(value: string, path: string): Problem | null {
  if (value.length <= L.templateMaxLength && STYLESHEET_PATTERN.test(value)) {
    return null;
  }
  return problem(
    'MANIFEST_BLOCK_STYLESHEET_INVALID',
    `\`${path}\` is ${quote(value)}; a stylesheet is a \`.css\` file of the app bundle, a relative path of lowercase letters, digits, "_" and "-", ${L.templateMaxLength} characters at most.`,
    `Set \`${path}\` to the stylesheet's path in the bundle, e.g. "blocks/star-rating.css".`,
  );
}

/** One entry of a block's `data`: `<owner>.<key>`. */
export function blockDataProblem(value: string, path: string): Problem | null {
  if (BLOCK_DATA_PATTERN.test(value)) return null;
  const owner = value.split('.')[0] ?? '';
  const owners = BLOCK_DATA_OWNERS.map((name) => `"${name}"`).join(', ');
  if (
    value.includes('.') &&
    (DATA_OWNERS as readonly string[]).includes(owner) &&
    !(BLOCK_DATA_OWNERS as readonly string[]).includes(owner)
  ) {
    return problem(
      'MANIFEST_BLOCK_DATA_INVALID',
      `\`${path}\` is ${quote(value)}; ${owner} data holds buyer data, which never reaches a store page.`,
      `Remove ${quote(value)} from the block's \`data\`; a block reads ${owners} data only.`,
    );
  }
  return problem(
    'MANIFEST_BLOCK_DATA_INVALID',
    `\`${path}\` is ${quote(value)}; a block reads app data as "<owner>.<key>", the owner one of ${owners}.`,
    `Write \`${path}\` as the owner and key of a [[data.definitions]] entry, e.g. "product.rating".`,
  );
}

export function settingKeyProblem(value: string, path: string): Problem | null {
  if (SETTING_KEY_PATTERN.test(value)) return null;
  const suggestion = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, L.settingKeyMaxLength);
  return problem(
    'MANIFEST_BLOCK_SETTING_KEY_INVALID',
    `\`${path}\` is ${quote(value)}; a setting key is 1 to ${L.settingKeyMaxLength} lowercase letters, digits and underscores, starting with a letter.`,
    `Set \`${path}\` to a key of that form, e.g. "${suggestion || 'show_count'}".`,
  );
}

export function optionValueProblem(
  value: string,
  path: string,
): Problem | null {
  if (SETTING_OPTION_VALUE_PATTERN.test(value)) return null;
  const suggestion = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, L.settingOptionValueMaxLength);
  return problem(
    'MANIFEST_BLOCK_SETTING_OPTION_INVALID',
    `\`${path}\` is ${quote(value)}; an option value is 1 to ${L.settingOptionValueMaxLength} lowercase letters, digits, "_" and "-", starting with a letter or digit.`,
    `Set \`${path}\` to a value of that form, e.g. "${suggestion || 'grid'}".`,
  );
}

// ── Setting values ─────────────────────────────────────────────────────────

/** What a setting's `default` must be, ending a sentence. */
export interface SettingRule {
  type: string;
  /** A `select`'s option values, valid ones only. */
  options: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
}

/** Control and invisible characters; `allowNewline` lets "\n" through. */
function strayCharacter(value: string, allowNewline: boolean): string | null {
  for (const char of value) {
    if (allowNewline && char === '\n') continue;
    if (INVISIBLE_CHARACTER.test(char)) {
      return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  return null;
}

/** A `string` or `text` default, one language of it, or the whole string. */
function textDefaultProblem(
  value: string,
  path: string,
  rule: SettingRule,
): Problem | null {
  const multiline = rule.type === 'text';
  const limit = rule.maxLength ?? L.settingTextMaxLength;
  const stray = strayCharacter(value, multiline);
  if (stray) {
    return problem(
      'MANIFEST_BLOCK_SETTING_DEFAULT_INVALID',
      `\`${path}\` holds an invisible, control${multiline ? '' : ' or line-break'} character (${stray}).`,
      `Remove the ${stray} character from \`${path}\`${multiline ? '' : ' and keep the text on one line'}.`,
    );
  }
  if (value.length > limit) {
    return problem(
      'MANIFEST_BLOCK_SETTING_DEFAULT_INVALID',
      `\`${path}\` is ${value.length} characters long; the setting holds at most ${limit}.`,
      `Shorten \`${path}\` to ${limit} characters or fewer.`,
    );
  }
  return null;
}

/** Whether a value is a table with exactly the keys `ar` and `en`. */
function isLabelTable(value: unknown): value is Record<'ar' | 'en', unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes('ar') && keys.includes('en');
}

function rangeText(rule: SettingRule): string {
  if (rule.min !== undefined && rule.max !== undefined) {
    return ` from ${rule.min} to ${rule.max}`;
  }
  if (rule.min !== undefined) return ` of at least ${rule.min}`;
  if (rule.max !== undefined) return ` of at most ${rule.max}`;
  return '';
}

/** "a boolean setting", "an image setting". */
function aSetting(type: string): string {
  return `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} setting`;
}

/** Where a setting's default fails: the field, or one language of it. */
export interface SettingDefaultProblem {
  language?: 'ar' | 'en';
  problem: Problem;
}

/**
 * A setting's `default`, judged by its type (`path` names the field): the
 * first problem, and the language it is in for a `{ ar, en }` default.
 */
export function settingDefaultProblem(
  value: unknown,
  path: string,
  rule: SettingRule,
): SettingDefaultProblem | null {
  const fail = (
    message: string,
    fix: string,
    language?: 'ar' | 'en',
  ): SettingDefaultProblem => ({
    ...(language ? { language } : {}),
    problem: problem('MANIFEST_BLOCK_SETTING_DEFAULT_INVALID', message, fix),
  });
  const shown = typeof value === 'string' ? quote(value) : describeType(value);
  switch (rule.type) {
    case 'image':
    case 'product':
    case 'collection':
      return fail(
        `\`${path}\` is set, but ${aSetting(rule.type)} takes no default: the merchant picks one from their own store.`,
        `Remove \`${path}\`.`,
      );
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : fail(
            `\`${path}\` is ${shown}; ${aSetting('boolean')}'s default is true or false.`,
            `Set \`${path}\` to true or false.`,
          );
    case 'integer':
    case 'number': {
      const whole = rule.type === 'integer';
      const ok =
        typeof value === 'number' &&
        (whole ? Number.isSafeInteger(value) : Number.isFinite(value));
      if (!ok) {
        return fail(
          `\`${path}\` is ${typeof value === 'number' ? String(value) : shown}; ${aSetting(rule.type)}'s default is ${whole ? 'a whole number' : 'a finite number'}.`,
          `Set \`${path}\` to ${whole ? 'a whole number' : 'a number'}${rangeText(rule)}.`,
        );
      }
      if (
        (rule.min !== undefined && value < rule.min) ||
        (rule.max !== undefined && value > rule.max)
      ) {
        return fail(
          `\`${path}\` is ${String(value)}, outside the setting's range${rangeText(rule)}.`,
          `Set \`${path}\` to a number${rangeText(rule)}.`,
        );
      }
      return null;
    }
    case 'select':
      if (typeof value === 'string' && rule.options.includes(value)) {
        return null;
      }
      return fail(
        `\`${path}\` is ${shown}, which is not the value of one of the setting's options.`,
        rule.options.length > 0
          ? `Set \`${path}\` to one of ${rule.options.map((option) => `"${option}"`).join(', ')}.`
          : `Set \`${path}\` to the \`value\` of one of the setting's options.`,
      );
    case 'color':
      return typeof value === 'string' && SETTING_COLOR_PATTERN.test(value)
        ? null
        : fail(
            `\`${path}\` is ${shown}; a color is written "#rrggbb".`,
            `Set \`${path}\` to a color such as "#1a7f5a".`,
          );
    case 'url': {
      if (typeof value !== 'string') {
        return fail(
          `\`${path}\` is ${shown}; ${aSetting('url')}'s default is a string.`,
          `Set \`${path}\` to an https URL or a path of the store starting with "/".`,
        );
      }
      const shape =
        value.length <= L.settingUrlMaxLength &&
        strayCharacter(value, false) === null &&
        !/[\s\\]/.test(value) &&
        (/^https:\/\/[^/?#]+(?:[/?#].*)?$/.test(value) ||
          /^\/(?!\/)/.test(value) ||
          value === '/');
      return shape
        ? null
        : fail(
            `\`${path}\` is ${shown}; a link is an https URL or a path of the store starting with "/", ${L.settingUrlMaxLength} characters at most, with no space.`,
            `Set \`${path}\` to a link such as "https://example.com/help" or "/collections/new".`,
          );
    }
    case 'string':
    case 'text': {
      if (typeof value === 'string') {
        const found = textDefaultProblem(value, path, rule);
        return found ? { problem: found } : null;
      }
      if (isLabelTable(value)) {
        for (const language of ['ar', 'en'] as const) {
          const text = value[language];
          const at = `${path}.${language}`;
          if (typeof text !== 'string') {
            return fail(
              `\`${at}\` is ${describeType(text)}; it must be a string.`,
              `Write \`${at}\` as a quoted string.`,
              language,
            );
          }
          const found = textDefaultProblem(text, at, rule);
          if (found) return { language, problem: found };
        }
        return null;
      }
      return fail(
        `\`${path}\` is ${shown}; ${aSetting(rule.type)}'s default is a string, or { ar = "…", en = "…" } for each language.`,
        `Set \`${path}\` to a string, or to a table with exactly the keys ar and en.`,
      );
    }
  }
  return null;
}
