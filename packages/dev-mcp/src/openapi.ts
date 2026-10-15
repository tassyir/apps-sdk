import { ToolError } from './errors.js';

// An OpenAPI 3.1 document indexed for an agent: the Admin API's (the copy
// @tassyir/app is typed from) or the developer API's (the copy the tassyir
// CLI is typed from). Its operations, its webhooks (one per topic) and its
// component schemas, rendered compactly: `$ref`s stay names the agent can ask
// for, long patterns and examples are dropped, descriptions are cut, and a
// rendering that would not fit the tool's answer is made shorter until it
// does. Read only: nothing here follows a URL the document names.

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };

type JsonObject = Record<string, unknown>;

/** The versioned prefix of every Admin API route; `@tassyir/app` paths leave it out. */
export const API_PREFIX = '/apps/2026-10';

/** The developer API's routes, all under one unversioned prefix. */
export const DEVELOPER_PREFIX = '/developer';

/** `admin`: what an installed app calls; `developer`: what the tassyir CLI calls. */
export type ApiName = 'admin' | 'developer';

export const API_TITLES: Readonly<Record<ApiName, string>> = {
  admin: 'Admin API',
  developer: 'developer API',
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export interface ApiOperation {
  id: string;
  /** Upper case. */
  method: string;
  /** As the document names it: `/apps/2026-10/orders/{id}`. */
  path: string;
  /** What `AdminClient` takes (`/orders/{id}`), or null outside `/apps/2026-10`. */
  sdkPath: string | null;
  tag: string;
  summary: string;
  description: string;
  raw: JsonObject;
}

export interface ApiEvent {
  topic: string;
  summary: string;
  description: string;
  raw: JsonObject;
}

export interface ApiIndex {
  name: ApiName;
  document: JsonObject;
  version: string;
  operations: ApiOperation[];
  events: ApiEvent[];
  schemaNames: string[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * A description without its pointers to the API's own reference files
 * (`Reference: docs/api/apps/…`, `(docs/api/apps/…)`): they live in
 * Tassyir's private source, so an agent cannot read them; the guides say the
 * same publicly.
 */
export function clean(value: string): string {
  return value
    .replace(
      /\s*Reference: docs\/api\/apps\/[\w.-]+(?:,\s*docs\/api\/apps\/[\w.-]+)*\.?/g,
      '',
    )
    .replace(/\s*\([^()]*docs\/api\/apps\/[^()]*\)/g, '')
    .trim();
}

/** The operations, webhooks and schemas of an OpenAPI document. */
export function indexApi(document: unknown, name: ApiName = 'admin'): ApiIndex {
  if (!isObject(document) || !isObject(document['paths'])) {
    throw new ToolError({
      code: 'CONTENT_UNAVAILABLE',
      message:
        "The server's copy of the API reference is not an OpenAPI document",
      fix: 'Reinstall the package (npx -y @tassyir/dev-mcp@latest), then restart the MCP server.',
    });
  }
  const operations: ApiOperation[] = [];
  for (const [path, item] of Object.entries(document['paths'])) {
    if (!isObject(item)) continue;
    // In the document's own order.
    for (const [method, operation] of Object.entries(item)) {
      if (!(METHODS as readonly string[]).includes(method)) continue;
      if (!isObject(operation) || typeof operation['operationId'] !== 'string')
        continue;
      const tags = operation['tags'];
      operations.push({
        id: operation['operationId'],
        method: method.toUpperCase(),
        path,
        sdkPath: path.startsWith(`${API_PREFIX}/`)
          ? path.slice(API_PREFIX.length)
          : null,
        tag: Array.isArray(tags) ? text(tags[0]) : '',
        summary: text(operation['summary']),
        description: clean(text(operation['description'])),
        raw: operation,
      });
    }
  }
  const events: ApiEvent[] = [];
  const webhooks = document['webhooks'];
  if (isObject(webhooks)) {
    for (const [topic, item] of Object.entries(webhooks)) {
      const operation = isObject(item) ? item['post'] : undefined;
      if (!isObject(operation)) continue;
      events.push({
        topic,
        summary: text(operation['summary']),
        description: clean(text(operation['description'])),
        raw: operation,
      });
    }
  }
  const components = document['components'];
  const schemas =
    isObject(components) && isObject(components['schemas'])
      ? components['schemas']
      : {};
  const info = document['info'];
  return {
    name,
    document,
    version: isObject(info) ? text(info['version']) : '',
    operations,
    events,
    schemaNames: Object.keys(schemas),
  };
}

// ── Finding an operation ─────────────────────────────────────────────────────

/** The words of an identifier or a path: `createBulkExport` → create, bulk, export. */
function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
}

/** The closest operation ids to what was asked, for a fix. */
function suggestions(
  indexes: readonly ApiIndex[],
  asked: string,
  limit = 5,
): string[] {
  const wanted = new Set(words(asked));
  return indexes
    .flatMap((index) => index.operations)
    .map((operation) => {
      const have = new Set([
        ...words(operation.id),
        ...words(operation.path),
        ...words(operation.summary),
      ]);
      let score = 0;
      for (const word of wanted) {
        if (have.has(word) || have.has(word.replace(/s$/, ''))) score += 1;
      }
      return { id: operation.id, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((candidate) => candidate.id);
}

function matchesTemplate(template: string, path: string): boolean {
  const want = template.split('/');
  const have = path.split('/');
  if (want.length !== have.length) return false;
  return want.every((segment, index) => {
    const other = have[index] ?? '';
    if (/^\{[^}]+\}$/.test(segment)) return other !== '';
    return segment === other;
  });
}

/**
 * An operation by its id (`createBulkExport`), or by method and path:
 * `POST /bulk/exports`, `GET /apps/2026-10/orders/{id}`, `GET /orders/123`.
 */
export function findOperation(index: ApiIndex, asked: string): ApiOperation {
  const query = asked.trim();
  const byId = index.operations.find(
    (operation) => operation.id.toLowerCase() === query.toLowerCase(),
  );
  if (byId) return byId;
  const match =
    /^(?:(get|post|put|patch|delete)\s+)?(\/\S*|https:\/\/\S+)$/i.exec(query);
  if (match) {
    const method = match[1]?.toUpperCase();
    let path = match[2] ?? '';
    // A whole URL (https://api.tassyir.io/apps/2026-10/orders) names its path.
    if (path.startsWith('https://'))
      path = URL.canParse(path) ? new URL(path).pathname : '';
    path = path.split('?')[0] ?? '';
    path = path.replace(/\/+$/, '') || '/';
    // `:id` placeholders read as `{id}`.
    path = path.replace(/\/:([A-Za-z_][\w]*)/g, '/{$1}');
    const full =
      path.startsWith('/apps/') ||
      path === DEVELOPER_PREFIX ||
      path.startsWith(`${DEVELOPER_PREFIX}/`)
        ? path
        : `${API_PREFIX}${path}`;
    const found = index.operations.filter(
      (operation) =>
        (method === undefined || operation.method === method) &&
        (operation.path === full || matchesTemplate(operation.path, full)),
    );
    // A literal segment beats a template one (`/bulk/exports` over `/{id}`).
    const exact = found.filter((operation) => operation.path === full);
    const candidates = exact.length > 0 ? exact : found;
    if (candidates.length === 1 && candidates[0]) return candidates[0];
    if (candidates.length > 1) {
      throw new ToolError({
        code: 'OPERATION_AMBIGUOUS',
        message: `${query} names ${String(candidates.length)} operations`,
        fix: `Ask for one of: ${candidates.map((operation) => `${operation.id} (${operation.method} ${operation.path})`).join(', ')}.`,
        details: { operations: candidates.map((operation) => operation.id) },
      });
    }
  }
  throw operationNotFound([index], query);
}

function operationNotFound(
  indexes: readonly ApiIndex[],
  query: string,
): ToolError {
  const close = suggestions(indexes, query);
  const titles = indexes.map((index) => API_TITLES[index.name]).join(' or ');
  const lists = indexes
    .map((index) =>
      index.name === 'admin'
        ? 'with no argument'
        : `with { "api": "${index.name}" }`,
    )
    .join(' or ');
  return new ToolError({
    code: 'OPERATION_NOT_FOUND',
    message: `No ${titles} operation is "${query.slice(0, 80)}"`,
    fix:
      close.length > 0
        ? `Try one of: ${close.join(', ')}; or call get_api_operation ${lists} to list every operation.`
        : `Call get_api_operation ${lists} to list every operation, or search_docs to find the one you need.`,
  });
}

/**
 * An operation of the first API that has it, in order: `operationId`s never
 * repeat across the two documents, and their paths never overlap.
 */
export function findOperationIn(
  indexes: readonly ApiIndex[],
  asked: string,
): { index: ApiIndex; operation: ApiOperation } {
  for (const index of indexes) {
    try {
      return { index, operation: findOperation(index, asked) };
    } catch (error) {
      if (!(error instanceof ToolError) || error.code !== 'OPERATION_NOT_FOUND')
        throw error;
    }
  }
  throw operationNotFound(indexes, asked.trim());
}

export function findSchema(index: ApiIndex, asked: string): string {
  return findSchemaIn([index], asked).name;
}

function schemaName(asked: string): string {
  return asked.trim().replace(/^#\/components\/schemas\//, '');
}

/**
 * A schema of the first API that has it, in order (the two documents share
 * a few names: `OAuthError`, `ServerError`).
 */
export function findSchemaIn(
  indexes: readonly ApiIndex[],
  asked: string,
): { index: ApiIndex; name: string } {
  const name = schemaName(asked);
  for (const index of indexes) {
    const found =
      index.schemaNames.find((candidate) => candidate === name) ??
      index.schemaNames.find(
        (candidate) => candidate.toLowerCase() === name.toLowerCase(),
      );
    if (found) return { index, name: found };
  }
  const wanted = new Set(words(name));
  const close = indexes
    .flatMap((index) => index.schemaNames)
    .filter((candidate) => words(candidate).some((word) => wanted.has(word)))
    .slice(0, 8);
  const titles = indexes.map((index) => API_TITLES[index.name]).join(' or ');
  throw new ToolError({
    code: 'SCHEMA_NOT_FOUND',
    message: `The ${titles} reference has no schema "${name.slice(0, 80)}"`,
    fix:
      close.length > 0
        ? `Try one of: ${close.join(', ')} (names are case-sensitive, as $ref names them).`
        : 'Use a name from a "$ref" or a "schemas" list of get_api_operation or get_event_schema, with the same "api".',
  });
}

export function findEvent(index: ApiIndex, topic: string): ApiEvent {
  const found = index.events.find((event) => event.topic === topic);
  if (found) return found;
  throw new ToolError({
    code: 'TOPIC_NOT_FOUND',
    message: `"${topic.slice(0, 80)}" is not a webhook topic of API version ${index.version}`,
    fix: `Use one of: ${index.events.map((event) => event.topic).join(', ')}.`,
  });
}

// ── Resolving and rendering schemas ──────────────────────────────────────────

/** Follows a local `$ref` (`#/components/parameters/IdempotencyKey`). */
function resolveRef(index: ApiIndex, node: unknown): unknown {
  if (!isObject(node) || typeof node['$ref'] !== 'string') return node;
  const path = node['$ref'];
  if (!path.startsWith('#/')) return node;
  let current: unknown = index.document;
  for (const part of path.slice(2).split('/')) {
    if (!isObject(current)) return node;
    current = current[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return current ?? node;
}

/** How much of a schema to show. */
interface Detail {
  /** Levels of nested properties shown; deeper objects become `{ type, "…": n }`. */
  depth: number;
  /** Characters of each description; 0 drops them. */
  descriptions: number;
}

/** From the most detailed rendering to the shortest one. */
const DETAILS: readonly Detail[] = [
  { depth: 6, descriptions: 240 },
  { depth: 4, descriptions: 160 },
  { depth: 3, descriptions: 100 },
  { depth: 3, descriptions: 60 },
  { depth: 2, descriptions: 0 },
  { depth: 1, descriptions: 0 },
];

export function cut(value: string, length: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (flat.length <= length) return flat;
  return `${flat.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
}

const KEPT = [
  'type',
  'const',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'default',
  'readOnly',
  'deprecated',
] as const;

/** A schema node, compact: what an agent needs to write a request or read an answer. */
function render(
  node: unknown,
  detail: Detail,
  level: number,
  refs: Set<string>,
): Json {
  if (!isObject(node)) return typeof node === 'boolean' ? node : null;
  const ref = node['$ref'];
  if (typeof ref === 'string') {
    const name = ref.replace(/^#\/components\/schemas\//, '');
    refs.add(name);
    return { $ref: name };
  }
  const out: Record<string, Json> = {};
  for (const key of KEPT) {
    const value = node[key];
    if (value !== undefined) out[key] = value as Json;
  }
  const pattern = node['pattern'];
  // Date-time patterns run to 300 characters: `format` says the same.
  if (typeof pattern === 'string' && pattern.length <= 60) {
    out['pattern'] = pattern;
  }
  const values = node['enum'];
  if (Array.isArray(values)) {
    out['enum'] =
      values.length > 40
        ? [
            ...(values.slice(0, 40) as Json[]),
            `… ${String(values.length - 40)} more`,
          ]
        : (values as Json[]);
  }
  const description = node['description'];
  if (typeof description === 'string' && detail.descriptions > 0) {
    out['description'] = cut(clean(description), detail.descriptions);
  }
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const list = node[key];
    if (Array.isArray(list)) {
      out[key] = list.map((child) => render(child, detail, level, refs));
    }
  }
  const items = node['items'];
  if (items !== undefined) out['items'] = render(items, detail, level, refs);
  const properties = node['properties'];
  if (isObject(properties)) {
    const names = Object.keys(properties);
    if (level >= detail.depth) {
      out['properties'] =
        `… ${String(names.length)} properties: ${names.join(', ')}`;
    } else {
      out['properties'] = Object.fromEntries(
        names.map((name) => [
          name,
          render(properties[name], detail, level + 1, refs),
        ]),
      );
    }
  }
  const required = node['required'];
  if (Array.isArray(required)) out['required'] = required as Json[];
  const additional = node['additionalProperties'];
  if (typeof additional === 'boolean') {
    out['additionalProperties'] = additional;
  } else if (isObject(additional)) {
    out['additionalProperties'] = render(additional, detail, level + 1, refs);
  }
  return out;
}

export interface Rendered<T> {
  value: T;
  /** Component schemas the rendering names by `$ref`, sorted. */
  refs: string[];
  /** True when it had to leave detail out to fit. */
  shortened: boolean;
}

/**
 * Builds a rendering at the most detailed level that fits `budget` bytes of
 * JSON, else at the shortest one.
 */
export function fitted<T>(
  budget: number,
  build: (detail: Detail, refs: Set<string>) => T,
): Rendered<T> {
  let last: Rendered<T> | undefined;
  for (const [position, detail] of DETAILS.entries()) {
    const refs = new Set<string>();
    const value = build(detail, refs);
    last = { value, refs: [...refs].sort(), shortened: position > 0 };
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') <= budget) return last;
  }
  if (!last) throw new Error('DETAILS is empty');
  return last;
}

/**
 * A request or answer body: a component it names by `$ref` is shown inline,
 * one level (its own `$ref`s stay names), with its name beside it.
 */
function renderBody(
  index: ApiIndex,
  schema: unknown,
  detail: Detail,
  refs: Set<string>,
): { schemaName?: string; schema: Json } {
  if (isObject(schema) && typeof schema['$ref'] === 'string') {
    const name = schema['$ref'].replace(/^#\/components\/schemas\//, '');
    const resolved = resolveRef(index, schema);
    if (resolved !== schema) {
      return { schemaName: name, schema: render(resolved, detail, 0, refs) };
    }
  }
  return { schema: render(schema, detail, 0, refs) };
}

function errorCodes(schema: unknown, index: ApiIndex): string[] {
  const codes = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    const resolved = resolveRef(index, node);
    if (!isObject(resolved) || depth > 4) return;
    const properties = resolved['properties'];
    if (isObject(properties)) {
      for (const key of ['code', 'error']) {
        const property = properties[key];
        const values = isObject(property) ? property['enum'] : undefined;
        if (Array.isArray(values)) {
          for (const value of values)
            if (typeof value === 'string') codes.add(value);
        }
      }
    }
    for (const key of ['allOf', 'anyOf', 'oneOf']) {
      const list = resolved[key];
      if (!Array.isArray(list)) continue;
      // In an allOf, a refinement narrows the base it sits beside: only the
      // refinement's enum, not the base's (Problem's open `code`, or
      // OAuthError's every `error`). At any depth: the developer API nests
      // them in an anyOf.
      const refinements =
        key === 'allOf'
          ? list.filter((child) => !isObject(child) || !('$ref' in child))
          : [];
      for (const child of refinements.length > 0 ? refinements : list)
        visit(child, depth + 1);
    }
  };
  visit(schema, 0);
  return [...codes].sort();
}

/**
 * The components a body may be when it may be one of several (`anyOf`): the
 * developer API answers a status with a coded `DeveloperError` or a body
 * without a code (`ValidationError`, `HttpError`, `RateLimitError`).
 */
function alternatives(schema: unknown): string[] {
  if (!isObject(schema) || !Array.isArray(schema['anyOf'])) return [];
  const refs = (schema['anyOf'] as unknown[]).flatMap((child) => {
    if (!isObject(child)) return [];
    if (typeof child['$ref'] === 'string') return [child['$ref']];
    const parts = child['allOf'];
    return Array.isArray(parts)
      ? parts.flatMap((part) =>
          isObject(part) && typeof part['$ref'] === 'string'
            ? [part['$ref']]
            : [],
        )
      : [];
  });
  return [
    ...new Set(refs.map((ref) => ref.replace(/^#\/components\/schemas\//, ''))),
  ];
}

function contentSchema(
  content: unknown,
): { type: string; schema: unknown } | undefined {
  if (!isObject(content)) return undefined;
  const [type, media] = Object.entries(content)[0] ?? [];
  if (type === undefined || !isObject(media)) return undefined;
  return { type, schema: media['schema'] };
}

function securityOf(index: ApiIndex, operation: JsonObject): string[] {
  const security = operation['security'] ?? index.document['security'];
  if (!Array.isArray(security)) return [];
  const components = index.document['components'];
  const schemes =
    isObject(components) && isObject(components['securitySchemes'])
      ? components['securitySchemes']
      : {};
  return security.flatMap((requirement) =>
    isObject(requirement)
      ? Object.keys(requirement).map((name) => {
          const scheme = schemes[name];
          return isObject(scheme) && typeof scheme['scheme'] === 'string'
            ? `${name} (HTTP ${scheme['scheme']})`
            : name;
        })
      : [],
  );
}

function parametersOf(
  index: ApiIndex,
  operation: JsonObject,
  detail: Detail,
  refs: Set<string>,
): Json[] {
  const list = operation['parameters'];
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const parameter = resolveRef(index, entry);
    if (!isObject(parameter)) return [];
    const description = text(parameter['description']);
    return [
      {
        name: text(parameter['name']),
        in: text(parameter['in']),
        required: parameter['required'] === true,
        ...(description && detail.descriptions > 0
          ? {
              description: cut(description, Math.max(detail.descriptions, 120)),
            }
          : {}),
        schema: render(parameter['schema'], detail, 0, refs),
      },
    ];
  });
}

/** One operation as `get_api_operation` answers it. */
export function renderOperation(
  index: ApiIndex,
  operation: ApiOperation,
  budget: number,
): Rendered<Record<string, Json>> {
  const raw = operation.raw;
  return fitted(budget, (detail, refs) => {
    const body = isObject(raw['requestBody']) ? raw['requestBody'] : undefined;
    const bodyContent = body ? contentSchema(body['content']) : undefined;
    const responses = isObject(raw['responses']) ? raw['responses'] : {};
    const answers: Json[] = [];
    const errors: Json[] = [];
    for (const [status, entry] of Object.entries(responses)) {
      const response = resolveRef(index, entry);
      if (!isObject(response)) continue;
      const media = contentSchema(response['content']);
      if (/^2/.test(status)) {
        answers.push({
          status,
          description: cut(text(response['description']), 160),
          ...(media
            ? {
                contentType: media.type,
                ...renderBody(index, media.schema, detail, refs),
              }
            : {}),
        });
      } else {
        const codes = media ? errorCodes(media.schema, index) : [];
        const shapes = media ? alternatives(media.schema) : [];
        if (shapes.length > 1) for (const shape of shapes) refs.add(shape);
        errors.push({
          status,
          ...(codes.length > 0
            ? { codes }
            : { description: cut(text(response['description']), 160) }),
          ...(shapes.length > 1 ? { shapes } : {}),
        });
      }
    }
    const extensions: Record<string, Json> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (
        key.startsWith('x-tassyir-') &&
        value !== null &&
        value !== undefined
      ) {
        extensions[key.slice('x-tassyir-'.length)] = value as Json;
      }
    }
    const parameters = parametersOf(index, raw, detail, refs);
    return {
      id: operation.id,
      method: operation.method,
      path: operation.path,
      sdkPath: operation.sdkPath,
      tag: operation.tag,
      summary: operation.summary,
      description: cut(
        operation.description,
        Math.max(detail.descriptions * 6, 400),
      ),
      auth: securityOf(index, raw),
      access: extensions,
      parameters,
      requestBody:
        body && bodyContent
          ? {
              required: body['required'] === true,
              contentType: bodyContent.type,
              ...renderBody(index, bodyContent.schema, detail, refs),
            }
          : null,
      responses: answers,
      errors,
    };
  });
}

/** A component schema as `get_api_operation { schema }` answers it. */
export function renderSchema(
  index: ApiIndex,
  name: string,
  budget: number,
): Rendered<Json> {
  const components = index.document['components'];
  const schemas =
    isObject(components) && isObject(components['schemas'])
      ? components['schemas']
      : {};
  return fitted(budget, (detail, refs) => {
    const value = render(schemas[name], detail, 0, refs);
    refs.delete(name);
    return value;
  });
}

/** A webhook topic as `get_event_schema` answers it. */
export function renderEvent(
  index: ApiIndex,
  event: ApiEvent,
  budget: number,
): Rendered<Record<string, Json>> {
  const raw = event.raw;
  return fitted(budget, (detail, refs) => {
    const body = isObject(raw['requestBody']) ? raw['requestBody'] : undefined;
    const media = body ? contentSchema(body['content']) : undefined;
    const responses = isObject(raw['responses']) ? raw['responses'] : {};
    const scope = raw['x-tassyir-scope'];
    return {
      topic: event.topic,
      summary: event.summary,
      description: cut(
        event.description,
        Math.max(detail.descriptions * 6, 400),
      ),
      scope: typeof scope === 'string' ? scope : null,
      headers: parametersOf(index, raw, { ...detail, depth: 1 }, refs),
      body: media ? renderBody(index, media.schema, detail, refs) : null,
      answer: Object.fromEntries(
        Object.entries(responses).map(([status, entry]) => {
          const response = resolveRef(index, entry);
          return [
            status,
            cut(isObject(response) ? text(response['description']) : '', 200),
          ];
        }),
      ),
    };
  });
}
