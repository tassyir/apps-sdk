import { compactTables, paginate } from './content.js';
import type { Content, Guide, GuideSection } from './content.js';
import { ToolError } from './errors.js';
import { cut } from './openapi.js';

// search_docs and fetch_doc: a small full-text index over the guides (one
// entry per section), the Admin API's operations and the webhook topics, and
// the guides themselves, page by page. Ranking is plain term weighting
// (headings over body, rare words over common ones); the same query always
// gives the same results in the same order.

/** Where a guide lives on GitHub today (developers.tassyir.io publishes it later). */
export const GUIDE_SOURCE =
  'https://github.com/tassyir/apps-sdk/blob/main/docs/guides';

/** Characters of Markdown per fetch_doc page. */
export const PAGE_CHARS = 3_500;

const STOP_WORDS = new Set(
  (
    'a an and are as at be by can do does for from has have how i if in is it ' +
    'its me my of on or should so that the their them then there this to use ' +
    'using was we what when where which who why will with you your'
  ).split(' '),
);

const WORD = /[\p{L}\p{N}_]+(?:[/.-][\p{L}\p{N}_]+)*/gu;

/** Lowercase words; a compound (`orders/created`, `read_orders`) also gives its parts. */
export function tokens(value: string): string[] {
  const found: string[] = [];
  for (const match of value.toLowerCase().matchAll(WORD)) {
    const word = match[0];
    found.push(word);
    if (/[/._-]/.test(word)) {
      for (const part of word.split(/[/._-]+/)) if (part) found.push(part);
    }
  }
  return found;
}

/** A query's terms: its words but common ones, a plural `s` dropped. */
export function queryTerms(query: string): string[] {
  const terms = tokens(query)
    .filter((word) => !STOP_WORDS.has(word))
    .map((word) =>
      word.length > 3 && /[^s]s$/.test(word) && !/[/._-]/.test(word)
        ? word.slice(0, -1)
        : word,
    );
  return [...new Set(terms)];
}

export type OpenRef =
  | { tool: 'fetch_doc'; arguments: { slug: string; section?: string } }
  | { tool: 'get_api_operation'; arguments: { operation: string } }
  | { tool: 'get_event_schema'; arguments: { topic: string } };

interface Entry {
  kind: 'guide' | 'operation' | 'event';
  title: string;
  /** Searched with the most weight. */
  heading: string[];
  /** Searched with some weight: the guide's title and description. */
  context: string[];
  /** Word counts of the body. */
  body: Map<string, number>;
  /** For snippets. */
  text: string;
  open: OpenRef;
  /** Ties break on it: guide order, then position. */
  rank: number;
}

export interface SearchIndex {
  entries: Entry[];
}

function counts(words: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const word of words) map.set(word, (map.get(word) ?? 0) + 1);
  return map;
}

/** Markdown as text to search: links keep their words, marks go. */
function plain(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildIndex(content: Content): SearchIndex {
  const entries: Entry[] = [];
  let rank = 0;
  for (const guide of content.guides) {
    const context = tokens(`${guide.title} ${guide.description}`);
    const intro = plain(guide.intro);
    entries.push({
      kind: 'guide',
      title: guide.title,
      heading: tokens(guide.title),
      context,
      body: counts(tokens(intro)),
      text: intro || guide.description,
      open: { tool: 'fetch_doc', arguments: { slug: guide.slug } },
      rank: (rank += 1),
    });
    for (const section of guide.sections) {
      if (section.level === 1) continue;
      const own = plain(section.own);
      entries.push({
        kind: 'guide',
        title: `${guide.title} › ${plain(section.title)}`,
        heading: tokens(section.title),
        context,
        body: counts(tokens(own)),
        text: own,
        open: {
          tool: 'fetch_doc',
          arguments: { slug: guide.slug, section: section.anchor },
        },
        rank: (rank += 1),
      });
    }
  }
  for (const operation of content.api.operations) {
    const path = operation.sdkPath ?? operation.path;
    const description = plain(operation.description);
    entries.push({
      kind: 'operation',
      title: `${operation.method} ${path}: ${operation.summary}`,
      heading: tokens(
        `${operation.summary} ${operation.id.replace(/([a-z])([A-Z])/g, '$1 $2')}`,
      ),
      context: tokens(`${operation.tag} ${path} admin api`),
      body: counts(tokens(description)),
      text: description,
      open: {
        tool: 'get_api_operation',
        arguments: { operation: operation.id },
      },
      rank: (rank += 1),
    });
  }
  for (const event of content.api.events) {
    const description = plain(event.description);
    entries.push({
      kind: 'event',
      title: `${event.topic} (webhook topic)`,
      heading: tokens(event.topic),
      context: tokens(`webhook event topic ${event.summary}`),
      body: counts(tokens(description)),
      text: description,
      open: { tool: 'get_event_schema', arguments: { topic: event.topic } },
      rank: (rank += 1),
    });
  }
  return { entries };
}

function hits(words: Iterable<string>, term: string): number {
  let found = 0;
  for (const word of words) if (word.startsWith(term)) found += 1;
  return found;
}

function bodyHits(body: Map<string, number>, term: string): number {
  let found = 0;
  for (const [word, count] of body) if (word.startsWith(term)) found += count;
  return found;
}

/** Up to ~240 characters around the first place a term appears. */
function snippetOf(
  text: string,
  terms: readonly string[],
  phrase: string,
): string {
  const lower = text.toLowerCase();
  let at = phrase.length >= 4 ? lower.indexOf(phrase) : -1;
  for (const term of terms) {
    if (at !== -1) break;
    at = lower.search(
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}`, 'u'),
    );
  }
  if (at === -1) return cut(text, 240);
  const start = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 80)) + 1);
  const slice = text.slice(start, start + 240);
  const end = slice.length < text.length - start ? slice.lastIndexOf(' ') : -1;
  return `${start > 0 ? '…' : ''}${end > 120 ? slice.slice(0, end) : slice}${
    start + slice.length < text.length ? '…' : ''
  }`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

export interface SearchResult {
  kind: 'guide' | 'operation' | 'event';
  title: string;
  snippet: string;
  /** Call this tool with these arguments to read the whole thing. */
  open: OpenRef;
}

/** The best entries for `query`, best first. */
export function search(
  index: SearchIndex,
  query: string,
  limit: number,
): { results: SearchResult[]; terms: string[] } {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    throw new ToolError({
      code: 'QUERY_EMPTY',
      message: `"${query.slice(0, 80)}" has no word to search for once common words are left out`,
      fix: 'Search for what you need in a few specific words: "webhook signature", "orders/created", "refresh token", "BULK_EXPORT_RATE_LIMITED".',
    });
  }
  const total = index.entries.length;
  const documentFrequency = new Map<string, number>();
  for (const term of terms) {
    documentFrequency.set(
      term,
      index.entries.filter(
        (entry) =>
          hits(entry.heading, term) > 0 ||
          hits(entry.context, term) > 0 ||
          bodyHits(entry.body, term) > 0,
      ).length,
    );
  }
  const phrase = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const scored = index.entries.flatMap((entry) => {
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const inHeading = hits(entry.heading, term) > 0 ? 1 : 0;
      const inContext = hits(entry.context, term) > 0 ? 1 : 0;
      const inBody = bodyHits(entry.body, term);
      if (inHeading + inContext + inBody === 0) continue;
      matched += 1;
      const idf = Math.log(
        1 + total / (1 + (documentFrequency.get(term) ?? 0)),
      );
      score += idf * (3 * inHeading + 1.5 * inContext + Math.log2(1 + inBody));
    }
    if (matched === 0) return [];
    score *= 0.5 + matched / terms.length;
    if (phrase.length >= 4 && entry.text.toLowerCase().includes(phrase))
      score *= 1.5;
    return [{ entry, score }];
  });
  scored.sort((a, b) => b.score - a.score || a.entry.rank - b.entry.rank);
  return {
    terms,
    results: scored.slice(0, limit).map(({ entry }) => ({
      kind: entry.kind,
      title: entry.title,
      snippet: snippetOf(entry.text, terms, phrase),
      open: entry.open,
    })),
  };
}

// ── fetch_doc ────────────────────────────────────────────────────────────────

export function findGuide(content: Content, slug: string): Guide {
  const guide = content.guides.find((candidate) => candidate.slug === slug);
  if (guide) return guide;
  const slugs = content.guides.map((candidate) => candidate.slug);
  throw new ToolError({
    code: 'DOC_NOT_FOUND',
    message: `There is no guide "${slug.slice(0, 80)}"`,
    fix: `Use one of: ${slugs.join(', ')}; or call search_docs.`,
  });
}

function findSection(guide: Guide, anchor: string): GuideSection {
  const wanted = anchor.replace(/^#/, '').toLowerCase();
  const section = guide.sections.find(
    (candidate) => candidate.anchor === wanted,
  );
  if (section) return section;
  throw new ToolError({
    code: 'SECTION_NOT_FOUND',
    message: `The guide "${guide.slug}" has no section "${anchor.slice(0, 80)}"`,
    fix: `Use one of its anchors: ${guide.sections
      .filter((candidate) => candidate.level > 1)
      .map((candidate) => candidate.anchor)
      .join(', ')}; or leave section out to read the guide from the top.`,
  });
}

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  source: string;
  section: { anchor: string; title: string } | null;
  page: number;
  pages: number;
  markdown: string;
  /** The guide's sections, on the first page of a whole guide. */
  outline?: { anchor: string; title: string }[];
}

/** One page of a guide, or of one of its sections. */
export function fetchDoc(
  content: Content,
  slug: string,
  sectionAnchor: string | undefined,
  page: number,
): DocPage {
  const guide = findGuide(content, slug);
  const section =
    sectionAnchor === undefined ? undefined : findSection(guide, sectionAnchor);
  const whole = section === undefined || section.level === 1;
  const pages = paginate(
    compactTables(whole ? guide.body.trim() : section.text),
    PAGE_CHARS,
  );
  if (page > pages.length) {
    throw new ToolError({
      code: 'PAGE_OUT_OF_RANGE',
      message: `${slug}${section ? `#${section.anchor}` : ''} has ${String(pages.length)} page${pages.length === 1 ? '' : 's'}, not ${String(page)}`,
      fix: `Ask for a page from 1 to ${String(pages.length)}.`,
    });
  }
  return {
    slug: guide.slug,
    title: guide.title,
    description: guide.description,
    source: `${GUIDE_SOURCE}/${guide.slug}.md${section && !whole ? `#${section.anchor}` : ''}`,
    section:
      section && !whole
        ? { anchor: section.anchor, title: section.title }
        : null,
    page,
    pages: pages.length,
    markdown: pages[page - 1] ?? '',
    ...(whole && page === 1
      ? {
          outline: guide.sections
            .filter((candidate) => candidate.level > 1)
            .map((candidate) => ({
              anchor: candidate.anchor,
              title: cut(candidate.title.replace(/`/g, ''), 60),
            })),
        }
      : {}),
  };
}

/** The guides, for fetch_doc without a slug. */
export function guideList(content: Content): {
  slug: string;
  title: string;
  description: string;
}[] {
  return content.guides.map((guide) => ({
    slug: guide.slug,
    title: guide.title,
    description: guide.description,
  }));
}
