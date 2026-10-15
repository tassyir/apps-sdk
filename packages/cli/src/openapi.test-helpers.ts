import { readFileSync } from 'node:fs';

// The developer API's OpenAPI document as the specs read it: the vendored
// copy the client's types are generated from (openapi/openapi.developer.json),
// the operation a request names, and a JSON Schema check of what goes in and
// out. The fake API (fake-api.test-helpers.ts) runs every request and answer
// through it, so the fake cannot drift from the document either.
//
// The check covers the keywords the document uses and THROWS on any other
// one, so a document that starts using a new keyword fails loudly here
// instead of being half checked. `format` is an annotation (the document
// gives every date-time a `pattern` too).

type JsonObject = Record<string, unknown>;

export const DEVELOPER_OPENAPI_URL = new URL(
  '../openapi/openapi.developer.json',
  import.meta.url,
);

export const DEVELOPER_OPENAPI = JSON.parse(
  readFileSync(DEVELOPER_OPENAPI_URL, 'utf8'),
) as JsonObject;

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const KEYWORDS = new Set([
  '$ref',
  'allOf',
  'anyOf',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames',
  'items',
  'enum',
  'const',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'format',
  'default',
  'description',
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Follows a local `$ref` (`#/components/schemas/DeveloperApp`). */
export function resolveRef(
  node: unknown,
  document: JsonObject = DEVELOPER_OPENAPI,
): unknown {
  if (!isObject(node) || typeof node['$ref'] !== 'string') return node;
  const ref = node['$ref'];
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  let current: unknown = document;
  for (const part of ref.slice(2).split('/')) {
    if (!isObject(current)) break;
    current = current[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  if (current === undefined) throw new Error(`$ref ${ref} resolves nowhere`);
  return current;
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    default:
      throw new Error(`unsupported type ${type}`);
  }
}

/**
 * Where `value` breaks `schema` (draft 2020-12, the document's keywords
 * only), as `$.data[0].status: …` lines; empty when it conforms.
 */
export function schemaProblems(
  schema: unknown,
  value: unknown,
  at = '$',
  document: JsonObject = DEVELOPER_OPENAPI,
): string[] {
  if (schema === true) return [];
  if (schema === false) return [`${at}: no value is allowed here`];
  if (!isObject(schema)) throw new Error(`${at}: a schema must be an object`);
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key)) {
      throw new Error(
        `${at}: the document uses "${key}", which this check does not implement: add it to openapi.test-helpers.ts`,
      );
    }
  }
  const problems: string[] = [];
  if ('$ref' in schema) {
    problems.push(
      ...schemaProblems(resolveRef(schema, document), value, at, document),
    );
  }
  const allOf = schema['allOf'];
  if (Array.isArray(allOf)) {
    for (const part of allOf) {
      problems.push(...schemaProblems(part, value, at, document));
    }
  }
  const anyOf = schema['anyOf'];
  if (Array.isArray(anyOf)) {
    const each = anyOf.map((part) => schemaProblems(part, value, at, document));
    if (!each.some((list) => list.length === 0)) {
      problems.push(
        `${at}: matches none of anyOf (${each.map((list) => list[0] ?? '').join(' | ')})`,
      );
    }
  }
  const type = schema['type'];
  if (type !== undefined) {
    const types = (Array.isArray(type) ? type : [type]).map((entry) =>
      typeof entry === 'string' ? entry : JSON.stringify(entry),
    );
    if (!types.some((candidate) => typeMatches(candidate, value))) {
      problems.push(
        `${at}: is ${JSON.stringify(value)}, not ${types.join(' or ')}`,
      );
      return problems;
    }
  }
  const values = schema['enum'];
  if (Array.isArray(values) && !values.some((option) => same(option, value))) {
    problems.push(
      `${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(values)}`,
    );
  }
  if ('const' in schema && !same(schema['const'], value)) {
    problems.push(
      `${at}: ${JSON.stringify(value)} is not ${JSON.stringify(schema['const'])}`,
    );
  }
  if (typeof value === 'string') {
    const pattern = schema['pattern'];
    if (typeof pattern === 'string' && !new RegExp(pattern, 'u').test(value)) {
      problems.push(
        `${at}: ${JSON.stringify(value)} does not match /${pattern}/`,
      );
    }
    // JSON Schema counts code points, as spreading a string does.
    // eslint-disable-next-line @typescript-eslint/no-misused-spread
    const length = [...value].length;
    const min = schema['minLength'];
    if (typeof min === 'number' && length < min) {
      problems.push(`${at}: shorter than ${String(min)}`);
    }
    const max = schema['maxLength'];
    if (typeof max === 'number' && length > max) {
      problems.push(`${at}: longer than ${String(max)}`);
    }
  }
  if (typeof value === 'number') {
    const min = schema['minimum'];
    if (typeof min === 'number' && value < min) {
      problems.push(`${at}: ${String(value)} is below ${String(min)}`);
    }
    const max = schema['maximum'];
    if (typeof max === 'number' && value > max) {
      problems.push(`${at}: ${String(value)} is above ${String(max)}`);
    }
  }
  if (isObject(value)) {
    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const key of required as string[]) {
        if (!(key in value)) problems.push(`${at}.${key}: is missing`);
      }
    }
    const properties = isObject(schema['properties'])
      ? schema['properties']
      : {};
    const additional = schema['additionalProperties'];
    for (const [key, item] of Object.entries(value)) {
      if (key in properties) {
        problems.push(
          ...schemaProblems(properties[key], item, `${at}.${key}`, document),
        );
      } else if (additional !== undefined) {
        problems.push(
          ...(additional === false
            ? [`${at}.${key}: is not a property the document names`]
            : schemaProblems(additional, item, `${at}.${key}`, document)),
        );
      }
    }
    const names = schema['propertyNames'];
    if (names !== undefined) {
      for (const key of Object.keys(value)) {
        problems.push(...schemaProblems(names, key, `${at}[${key}]`, document));
      }
    }
  }
  if (Array.isArray(value) && schema['items'] !== undefined) {
    value.forEach((item, index) => {
      problems.push(
        ...schemaProblems(
          schema['items'],
          item,
          `${at}[${String(index)}]`,
          document,
        ),
      );
    });
  }
  return problems;
}

export interface DocumentedOperation {
  id: string;
  /** Upper case. */
  method: string;
  /** The template: `/developer/apps/{appId}`. */
  path: string;
  raw: JsonObject;
}

/** Every operation of the document, in its order. */
export function documentedOperations(
  document: JsonObject = DEVELOPER_OPENAPI,
): DocumentedOperation[] {
  const paths = isObject(document['paths']) ? document['paths'] : {};
  return Object.entries(paths).flatMap(([path, item]) =>
    isObject(item)
      ? METHODS.flatMap((method) => {
          const raw = item[method];
          return isObject(raw) && typeof raw['operationId'] === 'string'
            ? [
                {
                  id: raw['operationId'],
                  method: method.toUpperCase(),
                  path,
                  raw,
                },
              ]
            : [];
        })
      : [],
  );
}

/**
 * The operation a request names: its method and concrete path. A literal
 * segment wins over a template (`/cli/tokens/current` over `/{tokenId}`).
 */
export function operationFor(
  method: string,
  path: string,
  document: JsonObject = DEVELOPER_OPENAPI,
): DocumentedOperation | undefined {
  const segments = path.split('/');
  const candidates = documentedOperations(document).filter((operation) => {
    if (operation.method !== method.toUpperCase()) return false;
    const template = operation.path.split('/');
    return (
      template.length === segments.length &&
      template.every(
        (segment, index) =>
          /^\{[^}]+\}$/.test(segment) || segment === segments[index],
      )
    );
  });
  const templated = (operation: DocumentedOperation) =>
    operation.path.split('/').filter((segment) => segment.startsWith('{'))
      .length;
  return candidates.sort((a, b) => templated(a) - templated(b))[0];
}

function mediaSchema(content: unknown, type: string): unknown {
  if (!isObject(content)) return undefined;
  const media = content[type];
  return isObject(media) ? media['schema'] : undefined;
}

/** What is wrong with a request the client sent, by the document. */
export function requestProblems(
  operation: DocumentedOperation,
  request: {
    query: URLSearchParams;
    contentType: string | null;
    body: string | undefined;
  },
  document: JsonObject = DEVELOPER_OPENAPI,
): string[] {
  const where = `${operation.id} request`;
  const problems: string[] = [];
  const parameters = Array.isArray(operation.raw['parameters'])
    ? operation.raw['parameters'].map((entry) => resolveRef(entry, document))
    : [];
  const known = new Set<string>();
  for (const parameter of parameters) {
    if (!isObject(parameter) || parameter['in'] !== 'query') continue;
    const name = String(parameter['name']);
    known.add(name);
    const raw = request.query.get(name);
    if (raw === null) {
      if (parameter['required'] === true)
        problems.push(`${where}: ?${name} is missing`);
      continue;
    }
    // A query value is text: read it as the type the schema names.
    const schema = resolveRef(parameter['schema'], document);
    const type = isObject(schema) ? schema['type'] : undefined;
    const value = type === 'integer' || type === 'number' ? Number(raw) : raw;
    problems.push(
      ...schemaProblems(schema, value, `${where} ?${name}`, document),
    );
  }
  for (const name of request.query.keys()) {
    if (!known.has(name))
      problems.push(`${where}: ?${name} is not a parameter of the operation`);
  }
  const body = resolveRef(operation.raw['requestBody'], document);
  if (!isObject(body)) {
    if (request.body !== undefined)
      problems.push(`${where}: sends a body the operation does not take`);
    return problems;
  }
  if (request.body === undefined) {
    if (body['required'] === true)
      problems.push(`${where}: the body is missing`);
    return problems;
  }
  const type = (request.contentType ?? '').split(';')[0]?.trim() ?? '';
  const schema = mediaSchema(body['content'], type);
  if (schema === undefined) {
    problems.push(
      `${where}: content type "${type}" is not one the operation takes`,
    );
    return problems;
  }
  const value: unknown =
    type === 'application/x-www-form-urlencoded'
      ? Object.fromEntries(new URLSearchParams(request.body))
      : (JSON.parse(request.body) as unknown);
  problems.push(...schemaProblems(schema, value, `${where} body`, document));
  return problems;
}

/** What is wrong with an answer, by the document: its status, then its body. */
export function responseProblems(
  operation: DocumentedOperation,
  status: number,
  body: unknown,
  document: JsonObject = DEVELOPER_OPENAPI,
): string[] {
  const responses = isObject(operation.raw['responses'])
    ? operation.raw['responses']
    : {};
  const entry = resolveRef(responses[String(status)], document);
  if (!isObject(entry)) {
    return [
      `${operation.id} answered ${String(status)}, which the document does not list (${Object.keys(responses).join(', ')})`,
    ];
  }
  const schema = mediaSchema(entry['content'], 'application/json');
  if (schema === undefined) return [];
  return schemaProblems(
    schema,
    body,
    `${operation.id} ${String(status)}`,
    document,
  );
}
