import { parse } from 'acorn';
import type {
  AnyNode,
  Expression,
  Node,
  Program,
  SpreadElement,
  Super,
} from 'acorn';
import { ancestor } from 'acorn-walk';
import { moduleKindOf } from './bundle-rules.js';
import type { BundleFile } from './bundle-rules.js';
import type { CliProblem } from './errors.js';

// What the hosted scan would refuse in a bundle's code, found before the
// upload. A COPY of the scan's deterministic code checks in tassyir/backend
// `tools/app-scans/scripts/lib/` (run in tassyir/app-scans): `js-analysis.mjs`
// (the syntax tree, read with acorn as there), and of `static-checks.mjs`
// the `banned_apis` check and the request half of `manifest_hosts`
// (`hosts.mjs`). Same rules, same severities, same words: a finding the
// scan reports as an error refuses the deploy here, a warning is printed.
// That includes the two rules the CLI had first and the scan took on (AP-B1.23):
// a `node:` import is an error (a hosted Worker has no Node.js compatibility,
// so Cloudflare would refuse the upload), and `main` must export a `fetch`
// handler (`no-fetch-handler` in `banned_apis`: Cloudflare refuses a Worker
// with no handler), judged as the scan judges it. The scan's other checks
// (unicode, manifest_scopes, Semgrep, Gitleaks, OSV, the AI review) run on
// Tassyir's side only. When a rule changes there, change it here.

/** A part of a string built at run time (the scan's marker). */
const DYNAMIC = '{x}';

const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window', 'global']);
const TIMERS = new Set(['setTimeout', 'setInterval']);
const NETWORK_CONSTRUCTORS = new Set(['Request', 'WebSocket', 'EventSource']);
const WASM_MEMBERS = new Set([
  'compile',
  'compileStreaming',
  'instantiate',
  'instantiateStreaming',
  'Module',
  'Instance',
]);
const TASSYIR_DOMAINS = ['tassyir.io', 'tassyir.shop', 'tassyir-apps.com'];

/** What the CLI does with each of the scan's rules: its code and fix. */
const RULES: Readonly<Record<string, { code: string; fix: string }>> = {
  'parse-error': {
    code: 'BUNDLE_PARSE_ERROR',
    fix: 'Report it at https://github.com/tassyir/apps-sdk/issues: the bundler wrote a module the scan cannot read.',
  },
  eval: {
    code: 'BUNDLE_EVAL',
    fix: 'Remove eval(): Workers refuse code built from strings (read data with JSON.parse).',
  },
  'function-constructor': {
    code: 'BUNDLE_FUNCTION_CONSTRUCTOR',
    fix: 'Remove new Function(…): Workers refuse code built from strings.',
  },
  'string-timer': {
    code: 'BUNDLE_STRING_TIMER',
    fix: 'Pass a function to setTimeout / setInterval, never a string.',
  },
  'constructor-constructor': {
    code: 'BUNDLE_CONSTRUCTOR_CONSTRUCTOR',
    fix: 'Remove the .constructor.constructor() call: it reaches the Function constructor.',
  },
  webassembly: {
    code: 'BUNDLE_WEBASSEMBLY',
    fix: 'Hosted apps ship text only: use JavaScript in place of WebAssembly.',
  },
  'dynamic-import': {
    code: 'BUNDLE_DYNAMIC_IMPORT',
    fix: "Import modules by a literal name (a static import, or import('./page.js')) so the bundle holds them.",
  },
  'raw-socket': {
    code: 'BUNDLE_RAW_SOCKET',
    fix: 'Use fetch() to a host in hosting.allowed_hosts: cloudflare:sockets is refused.',
  },
  'remote-import': {
    code: 'BUNDLE_REMOTE_IMPORT',
    fix: 'Install the package and import it by name, so esbuild bundles it.',
  },
  'node-builtin': {
    code: 'BUNDLE_NODE_IMPORT',
    fix: 'Hosted apps run without Node.js built-ins: use the Web APIs (fetch, crypto.subtle, TextEncoder, …) or a package that does not import node:.',
  },
  'unbundled-import': {
    code: 'BUNDLE_IMPORT_NOT_BUNDLED',
    fix: 'Install the package (npm install) so esbuild bundles it: only cloudflare:workers may stay an import.',
  },
  'dynamic-host': {
    code: 'BUNDLE_DYNAMIC_HOST',
    fix: 'Keep every host the app calls in hosting.allowed_hosts: the others will not be reachable.',
  },
  'tassyir-host': {
    code: 'BUNDLE_TASSYIR_HOST',
    fix: 'Call Tassyir through ctx.props.TASSYIR.fetch, never over the network (the scan refuses a request to a Tassyir domain).',
  },
  'host-not-allowed': {
    code: 'BUNDLE_HOST_NOT_ALLOWED',
    fix: 'Add the host to hosting.allowed_hosts in tassyir.app.toml, or remove the request.',
  },
  'not-https': {
    code: 'BUNDLE_NOT_HTTPS',
    fix: 'Use https:// (or wss://): a hosted app never calls a host in clear text.',
  },
  'no-fetch-handler': {
    code: 'BUNDLE_NO_FETCH_HANDLER',
    fix: 'Export the handler from the entry: export default { async fetch(request, env) { … } }.',
  },
};

export interface CodeFinding {
  /** The scan's rule (`dynamic-import`, `host-not-allowed`, …). */
  rule: string;
  severity: 'error' | 'warning';
  /** The bundle's file. */
  file: string;
  /** 1-based, in the bundle's file; null when the finding has no place. */
  line: number | null;
  /** 0-based. */
  column: number;
  message: string;
}

export interface CodeCheckResult {
  /** Refusals, in the problem shape (`path` = where in the source when known). */
  errors: CliProblem[];
  /** One line each. */
  warnings: string[];
  findings: CodeFinding[];
}

/** Where a bundle position came from, `src/worker.ts:12`, or null. */
export type Locate = (
  file: string,
  line: number,
  column: number,
) => string | null;

const PARSE_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  allowHashBang: true,
  allowAwaitOutsideFunction: true,
  locations: true,
} as const;

type Ban = (
  node: Node,
  rule: string,
  severity: CodeFinding['severity'],
  message: string,
) => void;

function lineOf(node: Node): { line: number | null; column: number } {
  return node.loc
    ? { line: node.loc.start.line, column: node.loc.start.column }
    : { line: null, column: 0 };
}

/**
 * The string a node evaluates to when it is built from literals, with
 * {@link DYNAMIC} for each part known only at run time; null when no part is
 * a literal.
 */
function foldString(node: AnyNode | null | undefined): string | null {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral') {
    let out = '';
    node.quasis.forEach((quasi, index) => {
      out += quasi.value.cooked ?? quasi.value.raw;
      if (index < node.expressions.length) {
        out += foldString(node.expressions[index]) ?? DYNAMIC;
      }
    });
    return out;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = foldString(node.left);
    const right = foldString(node.right);
    if (left === null && right === null) return null;
    return (left ?? DYNAMIC) + (right ?? DYNAMIC);
  }
  return null;
}

function isGlobalMember(node: AnyNode, name: string): boolean {
  return (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    node.property.name === name &&
    node.object.type === 'Identifier' &&
    GLOBAL_OBJECTS.has(node.object.name)
  );
}

/** `name` called directly or through a global object (`globalThis.eval`). */
function calleeIs(callee: Expression | Super, name: string): boolean {
  if (callee.type === 'Identifier') return callee.name === name;
  if (callee.type === 'SequenceExpression') {
    const last = callee.expressions[callee.expressions.length - 1];
    return last ? calleeIs(last, name) : false;
  }
  return isGlobalMember(callee, name);
}

function isStaticString(node: Expression | SpreadElement): boolean {
  return (
    (node.type === 'Literal' && typeof node.value === 'string') ||
    (node.type === 'TemplateLiteral' && node.expressions.length === 0)
  );
}

function reportFunctionConstructor(
  node: Node,
  args: readonly (Expression | SpreadElement)[],
  ban: Ban,
): void {
  const first = args[0];
  const probe =
    args.length === 0 ||
    (args.length === 1 && first?.type === 'Literal' && first.value === '');
  if (probe) {
    ban(
      node,
      'function-constructor',
      'warning',
      'Function("") is a feature probe; Workers refuse code from strings',
    );
  } else {
    ban(
      node,
      'function-constructor',
      'error',
      'new Function() runs code built from strings',
    );
  }
}

interface ModuleFacts {
  banned: {
    rule: string;
    severity: CodeFinding['severity'];
    node: Node;
    message: string;
  }[];
  imports: { specifier: string | null; node: Node }[];
  requests: { call: string; target: string | null; node: Node }[];
}

/** One module's facts, as the scan's `analyzeModule` reads them. */
function analyzeModule(ast: Program): ModuleFacts {
  const facts: ModuleFacts = { banned: [], imports: [], requests: [] };
  const ban: Ban = (node, rule, severity, message) =>
    facts.banned.push({ rule, severity, node, message });

  ancestor(ast, {
    CallExpression(node) {
      const { callee, arguments: args } = node;
      const first = args[0];
      if (calleeIs(callee, 'eval')) {
        if (first && !isStaticString(first)) {
          ban(node, 'eval', 'error', 'eval() runs code built at run time');
        } else {
          ban(node, 'eval', 'warning', 'eval() is not allowed on Workers');
        }
      }
      if (calleeIs(callee, 'Function'))
        reportFunctionConstructor(node, args, ban);
      if (callee.type === 'Identifier' && TIMERS.has(callee.name)) {
        if (first && foldString(first) !== null) {
          ban(
            node,
            'string-timer',
            'error',
            `${callee.name}() with a string runs it as code`,
          );
        }
      }
      if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'constructor' &&
        callee.object.type === 'MemberExpression' &&
        !callee.object.computed &&
        callee.object.property.type === 'Identifier' &&
        callee.object.property.name === 'constructor'
      ) {
        ban(
          node,
          'constructor-constructor',
          'error',
          '.constructor.constructor() reaches the Function constructor',
        );
      }
      if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'WebAssembly' &&
        callee.property.type === 'Identifier' &&
        WASM_MEMBERS.has(callee.property.name)
      ) {
        ban(
          node,
          'webassembly',
          'warning',
          `WebAssembly.${callee.property.name}() compiles code the scan cannot read`,
        );
      }
      if (calleeIs(callee, 'fetch') && first) {
        facts.requests.push({ call: 'fetch', target: foldString(first), node });
      }
    },
    NewExpression(node) {
      const { callee, arguments: args } = node;
      if (calleeIs(callee, 'Function'))
        reportFunctionConstructor(node, args, ban);
      const first = args[0];
      if (
        callee.type === 'Identifier' &&
        NETWORK_CONSTRUCTORS.has(callee.name) &&
        first
      ) {
        facts.requests.push({
          call: `new ${callee.name}`,
          target: foldString(first),
          node,
        });
      }
    },
    ImportExpression(node) {
      const value = foldString(node.source);
      if (value === null || value.includes(DYNAMIC)) {
        ban(
          node,
          'dynamic-import',
          'error',
          'import() of a module named at run time',
        );
      }
      facts.imports.push({ specifier: value, node });
    },
    ImportDeclaration(node) {
      facts.imports.push({ specifier: String(node.source.value), node });
    },
    ExportNamedDeclaration(node) {
      if (node.source) {
        facts.imports.push({ specifier: String(node.source.value), node });
      }
    },
    ExportAllDeclaration(node) {
      facts.imports.push({ specifier: String(node.source.value), node });
    },
  });
  return facts;
}

/** The scan's `importFinding`, with `node:` an error (see above). */
function importProblem(
  specifier: string,
): { rule: string; message: string } | null {
  if (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier === 'cloudflare:workers'
  ) {
    return null;
  }
  if (specifier === 'cloudflare:sockets') {
    return {
      rule: 'raw-socket',
      message:
        'cloudflare:sockets opens TCP connections the egress allowlist cannot see',
    };
  }
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(specifier) ||
    specifier.startsWith('data:') ||
    specifier.startsWith('blob:')
  ) {
    return {
      rule: 'remote-import',
      message: `imports code from a URL (${specifier.slice(0, 80)})`,
    };
  }
  if (specifier.startsWith('node:')) {
    return {
      rule: 'node-builtin',
      message: `${specifier} needs Node.js compatibility, which hosted apps do not have`,
    };
  }
  return {
    rule: 'unbundled-import',
    message: `imports "${specifier.slice(0, 80)}", which is not in the bundle`,
  };
}

export function isTassyirHost(host: string): boolean {
  return TASSYIR_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/** `allowed_hosts`: an exact name, or `*.` + a name for its subdomains (never the name). */
export function hostAllowed(
  host: string,
  allowedHosts: readonly string[],
): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some((entry) =>
    entry.startsWith('*.')
      ? name.endsWith(`.${entry.slice(2)}`)
      : name === entry,
  );
}

/** `https://[user@]host[:port]/…` → `{ scheme, host }`, or null (the user part is never the host). */
function urlHost(text: string): { scheme: string; host: string } | null {
  const match =
    /^(https?|wss?):\/\/(?:[^/?#\s@]*@)?(\[[^\]]*\]|[^/?#\s:@]+)(?::\d*)?(?:[/?#]|$)/i.exec(
      text,
    );
  if (!match?.[1] || !match[2]) return null;
  return { scheme: match[1].toLowerCase(), host: match[2].toLowerCase() };
}

// ── The fetch handler (the scan's no-fetch-handler) ────────────────────────

type Verdict = 'yes' | 'no' | 'unknown';

/** Whether an object literal or a class holds `fetch`. */
function holdsFetch(node: AnyNode): Verdict {
  if (node.type === 'ObjectExpression') {
    let spread = false;
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        spread = true;
        continue;
      }
      if (!property.computed && keyIs(property.key, 'fetch')) return 'yes';
    }
    return spread ? 'unknown' : 'no';
  }
  if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
    for (const member of node.body.body) {
      if (
        (member.type === 'MethodDefinition' ||
          member.type === 'PropertyDefinition') &&
        !member.static &&
        !member.computed &&
        keyIs(member.key, 'fetch')
      ) {
        return 'yes';
      }
    }
    // A subclass may inherit `fetch`.
    return node.superClass ? 'unknown' : 'no';
  }
  if (
    node.type === 'Literal' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration'
  ) {
    return 'no';
  }
  return 'unknown';
}

function keyIs(key: AnyNode, name: string): boolean {
  return (
    (key.type === 'Identifier' && key.name === name) ||
    (key.type === 'Literal' && key.value === name)
  );
}

/** What a top-level name is bound to, or null. */
function topLevelBinding(ast: Program, name: string): AnyNode | null {
  for (const statement of ast.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration'
        ? statement.declaration
        : statement;
    if (!declaration) continue;
    if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (
          declarator.id.type === 'Identifier' &&
          declarator.id.name === name
        ) {
          return declarator.init ?? null;
        }
      }
    }
    if (
      (declaration.type === 'ClassDeclaration' ||
        declaration.type === 'FunctionDeclaration') &&
      declaration.id.name === name
    ) {
      return declaration;
    }
  }
  return null;
}

/** Null when the module's default export may hold `fetch`, else why not. */
function fetchHandlerProblem(ast: Program): string | null {
  let exported: AnyNode | null | undefined;
  for (const statement of ast.body) {
    if (statement.type === 'ExportDefaultDeclaration') {
      exported = statement.declaration;
    }
    if (statement.type === 'ExportNamedDeclaration') {
      for (const specifier of statement.specifiers) {
        if (!keyIs(specifier.exported, 'default')) continue;
        // Re-exported from another module, or bound elsewhere: cannot tell.
        if (statement.source || specifier.local.type !== 'Identifier') {
          return null;
        }
        exported = topLevelBinding(ast, specifier.local.name);
        if (exported === null) return null;
      }
    }
  }
  if (exported === undefined) return 'has no default export';
  // Follow `var a = b` a few times: esbuild writes `var src_default = app`.
  for (let hops = 0; hops < 5 && exported?.type === 'Identifier'; hops += 1) {
    exported = topLevelBinding(ast, exported.name);
  }
  if (!exported) return null;
  return holdsFetch(exported) === 'no'
    ? 'exports a default without a fetch handler'
    : null;
}

// ── The checks ─────────────────────────────────────────────────────────────

/**
 * The bundle's ES modules, checked as the scan checks them (its `node:` and
 * fetch-handler rules included). `allowedHosts` is the manifest's
 * `hosting.allowed_hosts`.
 */
export function checkBundleCode(
  files: readonly BundleFile[],
  main: string,
  allowedHosts: readonly string[],
  locate: Locate = () => null,
): CodeCheckResult {
  const findings: CodeFinding[] = [];
  const add = (
    file: string,
    node: Node | null,
    rule: string,
    severity: CodeFinding['severity'],
    message: string,
  ) => {
    const at = node ? lineOf(node) : { line: null, column: 0 };
    findings.push({ rule, severity, file, ...at, message });
  };

  for (const file of files) {
    if (moduleKindOf(file.path) !== 'esm') continue;
    let ast: Program;
    try {
      ast = parse(file.content, PARSE_OPTIONS);
    } catch (error) {
      add(
        file.path,
        null,
        'parse-error',
        'error',
        `The module could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const facts = analyzeModule(ast);
    for (const hit of facts.banned) {
      add(file.path, hit.node, hit.rule, hit.severity, hit.message);
    }
    for (const entry of facts.imports) {
      if (entry.specifier === null) continue; // reported as dynamic-import
      const problem = importProblem(entry.specifier);
      if (problem) {
        add(file.path, entry.node, problem.rule, 'error', problem.message);
      }
    }
    for (const request of facts.requests) {
      if (request.target === null) continue; // built at run time: the egress allowlist decides
      const target = urlHost(request.target);
      if (!target) continue; // a relative URL: the app's own origin
      if (target.host.includes(DYNAMIC) || target.host.includes('{')) {
        add(
          file.path,
          request.node,
          'dynamic-host',
          'warning',
          `${request.call}() to a host built at run time; only allowed_hosts will be reachable`,
        );
      } else if (isTassyirHost(target.host)) {
        add(
          file.path,
          request.node,
          'tassyir-host',
          'error',
          `${request.call}() to ${target.host}: call Tassyir through env.TASSYIR`,
        );
      } else if (!hostAllowed(target.host, allowedHosts)) {
        add(
          file.path,
          request.node,
          'host-not-allowed',
          'error',
          `${request.call}() to ${target.host}, which is not in hosting.allowed_hosts`,
        );
      } else if (target.scheme === 'http' || target.scheme === 'ws') {
        add(
          file.path,
          request.node,
          'not-https',
          'error',
          `${request.call}() over ${target.scheme}: use https`,
        );
      }
    }
    if (file.path === main) {
      const problem = fetchHandlerProblem(ast);
      if (problem) {
        add(
          file.path,
          null,
          'no-fetch-handler',
          'error',
          `${file.path} ${problem}: Cloudflare runs a hosted app through its default export's fetch(request, env)`,
        );
      }
    }
  }

  // Errors first, then by place: the order they read in the source.
  const rank = (finding: CodeFinding) => (finding.severity === 'error' ? 0 : 1);
  findings.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.column - b.column,
  );
  const where = (finding: CodeFinding): string => {
    if (finding.line === null) return finding.file;
    return (
      locate(finding.file, finding.line, finding.column) ??
      `${finding.file}:${String(finding.line)}`
    );
  };
  const errors: CliProblem[] = [];
  const warnings: string[] = [];
  for (const finding of findings) {
    const rule = RULES[finding.rule];
    if (finding.severity === 'error') {
      errors.push({
        code: rule?.code ?? 'BUNDLE_CODE_REFUSED',
        path: where(finding),
        message: finding.message,
        fix: rule?.fix ?? 'Change the code the finding names.',
      });
    } else {
      warnings.push(`${where(finding)}: ${finding.message}.`);
    }
  }
  return { errors, warnings, findings };
}
