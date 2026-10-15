import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from './errors.js';
import { indexApi } from './openapi.js';
import type { ApiIndex } from './openapi.js';

// What the server knows without a network: the public developer guides
// (apps-sdk docs/guides, one Markdown file per topic, the file name is the
// slug) and the Admin API's OpenAPI document that @tassyir/app is typed from.
// The build copies both into dist/content/ (tsdown.config.ts), so a release
// answers from the guides and the API version it was released with. From a
// checkout of tassyir/apps-sdk (specs, running from source) the server reads
// the sources themselves.
//
// The text is data: nothing here follows a link or acts on what a guide says.

export interface ContentPaths {
  /** The folder of the guides (`<slug>.md`). */
  guides: string;
  /** The Admin API's OpenAPI document. */
  openapi: string;
}

/** dist/content/ in a release; the repo's own files in a checkout. */
export function defaultContentPaths(): ContentPaths {
  const shipped = fileURLToPath(new URL('./content/', import.meta.url));
  if (existsSync(join(shipped, 'guides'))) {
    return {
      guides: join(shipped, 'guides'),
      openapi: join(shipped, 'openapi', 'openapi.2026-10.json'),
    };
  }
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  return {
    guides: join(root, 'docs', 'guides'),
    openapi: join(root, 'packages', 'app', 'openapi', 'openapi.2026-10.json'),
  };
}

/** A heading of a guide and the text under it. */
export interface GuideSection {
  /** GitHub's anchor: what `guide.md#anchor` links name. */
  anchor: string;
  /** The heading's text, as written. */
  title: string;
  /** 1 for the guide's title, 2 for `##`, … */
  level: number;
  /** The heading line and everything up to the next heading of the same or a higher level. */
  text: string;
  /** The text under the heading, up to the next heading of any level (the heading line excluded). */
  own: string;
}

export interface Guide {
  slug: string;
  title: string;
  description: string;
  order: number;
  /** The Markdown after the front matter. */
  body: string;
  /** The text before the first `##`, the `# Title` line excluded. */
  intro: string;
  /** Every heading in order, the title included. */
  sections: GuideSection[];
}

export interface Content {
  /** By `order`, as the docs site lists them. */
  guides: Guide[];
  api: ApiIndex;
}

/** Reads and indexes the guides and the OpenAPI document. */
export async function loadContent(paths: ContentPaths): Promise<Content> {
  let files: string[];
  try {
    files = (await readdir(paths.guides)).filter(
      // README.md is for the guides' authors, not a guide.
      (file) => file.endsWith('.md') && file !== 'README.md',
    );
  } catch (error) {
    throw contentUnavailable(paths.guides, error);
  }
  const guides = await Promise.all(
    files.map(async (file) =>
      parseGuide(
        file.slice(0, -3),
        await readFile(join(paths.guides, file), 'utf8'),
      ),
    ),
  );
  guides.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  let document: unknown;
  try {
    document = JSON.parse(await readFile(paths.openapi, 'utf8')) as unknown;
  } catch (error) {
    throw contentUnavailable(paths.openapi, error);
  }
  return { guides, api: indexApi(document) };
}

function contentUnavailable(path: string, error: unknown): ToolError {
  const reason =
    (error as NodeJS.ErrnoException | undefined)?.code ?? 'unreadable';
  return new ToolError({
    code: 'CONTENT_UNAVAILABLE',
    message: `The server's copy of the guides and the API reference could not be read (${reason}: ${path})`,
    fix: 'Reinstall the package (npx -y @tassyir/dev-mcp@latest), then restart the MCP server.',
  });
}

/** Splits a guide into its front matter (`title`, `description`, `order`) and indexed body. */
export function parseGuide(slug: string, source: string): Guide {
  const text = source.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const values: Record<string, string> = {};
  for (const line of (match?.[1] ?? '').split('\n')) {
    const field = /^([a-z]+):\s*(.*)$/.exec(line);
    if (field?.[1]) values[field[1]] = unquote((field[2] ?? '').trim());
  }
  const body = match ? text.slice(match[0].length) : text;
  const sections = sectionsOf(body);
  const lines = body.split('\n');
  const titleLine = lines.findIndex((line) => /^#\s+/.test(line));
  const firstSection = headingLines(lines).find((line) => line > titleLine);
  const intro = lines
    .slice(titleLine + 1, firstSection ?? lines.length)
    .join('\n')
    .trim();
  return {
    slug,
    title: values['title'] ?? sections[0]?.title ?? slug,
    description: values['description'] ?? '',
    order: Number(values['order'] ?? Number.MAX_SAFE_INTEGER),
    body,
    intro,
    sections,
  };
}

function unquote(value: string): string {
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  return quoted ? (quoted[1] ?? '') : value;
}

/**
 * The lines inside fenced code blocks, by CommonMark's rules (as the
 * guides' own checker reads them): an opener is 3 or more backticks or
 * tildes indented at most 3 spaces; it closes on a run of the same
 * character at least as long. An unclosed fence runs to the end.
 */
export function fencedLines(lines: readonly string[]): Set<number> {
  const fenced = new Set<number>();
  for (let index = 0; index < lines.length; index += 1) {
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index] ?? '');
    if (!open) continue;
    const marker = open[1] ?? '';
    if (marker.startsWith('`') && (open[2] ?? '').includes('`')) continue;
    let close = index + 1;
    while (close < lines.length) {
      const run = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[close] ?? '')?.[1];
      if (
        run !== undefined &&
        run[0] === marker[0] &&
        run.length >= marker.length
      )
        break;
      close += 1;
    }
    for (let line = index; line <= Math.min(close, lines.length - 1); line += 1)
      fenced.add(line);
    index = close;
  }
  return fenced;
}

const HEADING = /^(#{1,6})\s+(.*)$/;

function headingLines(lines: readonly string[]): number[] {
  const fenced = fencedLines(lines);
  return lines.flatMap((line, index) =>
    !fenced.has(index) && HEADING.test(line) ? [index] : [],
  );
}

/**
 * GitHub's heading anchor: the text without Markdown marks, lowercased,
 * every character but letters, digits, "-", "_" and spaces dropped, spaces
 * to "-" (the rule the guides' link checker uses).
 */
export function anchorOf(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function sectionsOf(body: string): GuideSection[] {
  const lines = body.split('\n');
  const headings = headingLines(lines).map((line) => {
    const match = HEADING.exec(lines[line] ?? '');
    return {
      line,
      level: match?.[1]?.length ?? 1,
      title: (match?.[2] ?? '').replace(/\s+#+\s*$/, '').trim(),
    };
  });
  const seen = new Map<string, number>();
  return headings.map((heading, index) => {
    const base = anchorOf(heading.title);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const next = headings.find(
      (other, at) => at > index && other.level <= heading.level,
    );
    const nextAny = headings[index + 1];
    return {
      anchor: count === 0 ? base : `${base}-${String(count)}`,
      title: heading.title,
      level: heading.level,
      text: lines
        .slice(heading.line, next?.line ?? lines.length)
        .join('\n')
        .trim(),
      own: lines
        .slice(heading.line + 1, nextAny?.line ?? lines.length)
        .join('\n')
        .trim(),
    };
  });
}

/**
 * Cuts Markdown into pages of at most `size` characters, between blocks
 * (blank lines outside code fences) when it can, else between lines, so a
 * page never ends inside a word and, unless a single block is longer than a
 * page, never inside a code sample.
 */
export function paginate(markdown: string, size: number): string[] {
  const lines = markdown.split('\n');
  const fenced = fencedLines(lines);
  // A page may start at a block's first line: after a blank line, outside a fence.
  const starts = new Set<number>([0]);
  for (let index = 1; index < lines.length; index += 1) {
    if (
      !fenced.has(index - 1) &&
      (lines[index - 1] ?? '').trim() === '' &&
      (lines[index] ?? '').trim() !== ''
    ) {
      starts.add(index);
    }
    // A fence's opening line is a block start too.
    if (fenced.has(index) && !fenced.has(index - 1)) starts.add(index);
  }
  const length = (from: number, to: number) =>
    lines.slice(from, to).join('\n').trim().length;

  const pages: string[] = [];
  let from = 0;
  while (from < lines.length) {
    let to = from + 1;
    // The furthest block start that keeps the page within size.
    for (let candidate = from + 1; candidate <= lines.length; candidate += 1) {
      if (candidate !== lines.length && !starts.has(candidate)) continue;
      if (length(from, candidate) > size) break;
      to = candidate;
    }
    if (length(from, to) > size || (to === from + 1 && !starts.has(to))) {
      // One block longer than a page: as many whole lines as fit.
      to = from + 1;
      while (to < lines.length && length(from, to + 1) <= size) to += 1;
    }
    const page = lines.slice(from, to).join('\n').trim();
    if (page.length > size) {
      // One line longer than a page.
      for (let at = 0; at < page.length; at += size) {
        pages.push(page.slice(at, at + size));
      }
    } else if (page !== '') {
      pages.push(page);
    }
    from = to;
  }
  return pages.length > 0 ? pages : [''];
}

/**
 * Markdown tables without their alignment padding (Prettier pads every
 * column to its widest cell): the same table in far fewer characters.
 */
export function compactTables(markdown: string): string {
  const lines = markdown.split('\n');
  const fenced = fencedLines(lines);
  return lines
    .map((line, index) =>
      !fenced.has(index) && /^\s*\|/.test(line)
        ? line.replace(/ {2,}/g, ' ').replace(/-{4,}/g, '---')
        : line,
    )
    .join('\n');
}
