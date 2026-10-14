// The payload each call posts, built from named fields and checked against
// §3.9's rules first, so an app hears a refusal before posting and never
// sends a field it did not mean (unknown fields are not copied; a field set
// to `undefined` is left out, as if it was not given).
//
// The verdicts equal the dashboard's own reader (the frontend's
// `parseBridgeMessage`); `npm run crosscheck -w @tassyir/app-bridge` proves
// it against the real one.

import {
  BRIDGE_LIMITS,
  DASHBOARD_DESTINATIONS,
  MODAL_SIZES,
  PICK_TYPES,
  TOAST_TONES,
  type BridgeCall,
} from './protocol.js';

export interface PayloadProblem {
  /** The payload field at fault, or null for the payload itself. */
  path: string | null;
  message: string;
  fix: string;
}

export type BuiltPayload =
  | { ok: true; payload: Record<string, unknown> }
  | ({ ok: false } & PayloadProblem);

type Fields = Record<string, unknown>;

// Control characters, and the bidi embeddings, overrides and isolates: the
// dashboard turns them into spaces in text and refuses them in paths.
// eslint-disable-next-line no-control-regex -- these are the characters §3.9 names
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
// eslint-disable-next-line no-control-regex -- the same set, tested once
const HAS_UNSAFE_CHAR = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;

const problem = (
  path: string | null,
  message: string,
  fix: string,
): { ok: false } & PayloadProblem => ({ ok: false, path, message, fix });

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const list = (values: readonly string[]) =>
  values.map((value) => `"${value}"`).join(', ');

/** Text the dashboard will show: refused when not a string, too long as sent, or empty once cleaned. */
function textProblem(
  call: BridgeCall,
  field: string,
  value: unknown,
  shown: number,
): PayloadProblem | null {
  if (typeof value !== 'string') {
    return {
      path: field,
      message: `${call}: ${field} must be a string.`,
      fix: `Pass ${field} as text.`,
    };
  }
  if (value.length > BRIDGE_LIMITS.textMaxLength) {
    return {
      path: field,
      message: `${call}: ${field} is ${value.length} characters; the dashboard refuses more than ${BRIDGE_LIMITS.textMaxLength}.`,
      fix: `Shorten ${field}: the dashboard shows at most ${shown} characters.`,
    };
  }
  if (value.replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim() === '') {
    return {
      path: field,
      message: `${call}: ${field} is empty once control characters, bidi controls and extra white space are removed.`,
      fix: `Pass ${field} with visible text.`,
    };
  }
  return null;
}

/**
 * An app path: `/`, `/reviews/2`, `/reviews?tab=sent`. Relative to the app's
 * `admin.page`, never an address.
 */
export function appPathProblem(
  call: BridgeCall,
  value: unknown,
  field = 'path',
): PayloadProblem | null {
  const at = `${call}: ${field}`;
  if (typeof value !== 'string') {
    return {
      path: field,
      message: `${at} must be a string.`,
      fix: 'Pass an app path such as "/reviews/2?tab=sent".',
    };
  }
  if (value.length > BRIDGE_LIMITS.pathMaxLength) {
    return {
      path: field,
      message: `${at} is ${value.length} characters; at most ${BRIDGE_LIMITS.pathMaxLength} with its query.`,
      fix: 'Shorten the path or its query; keep large state on your server.',
    };
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return {
      path: field,
      message: `${at} must start with a single "/": it is a path inside the app (relative to its admin.page), never a URL.`,
      fix: 'Pass the path only, like "/settings", without a scheme or host.',
    };
  }
  if (/[\s\\#]/.test(value) || HAS_UNSAFE_CHAR.test(value)) {
    return {
      path: field,
      message: `${at} contains white space, a backslash, a "#" fragment, a control character or a bidi control.`,
      fix: 'Percent-encode special characters (encodeURIComponent each segment) and drop the fragment.',
    };
  }
  const queryAt = value.indexOf('?');
  const path = queryAt === -1 ? value : value.slice(0, queryAt);
  if (path.length > BRIDGE_LIMITS.pathBeforeQueryMaxLength) {
    return {
      path: field,
      message: `${at} is ${path.length} characters before its "?"; at most ${BRIDGE_LIMITS.pathBeforeQueryMaxLength}.`,
      fix: 'Shorten the path; keep large state on your server.',
    };
  }
  if (path !== '/') {
    // One trailing slash is the same page; every other segment must be real.
    for (const part of path.replace(/\/$/, '').slice(1).split('/')) {
      let segment: string;
      try {
        segment = decodeURIComponent(part);
      } catch {
        segment = '';
      }
      if (segment === '' || segment === '.' || segment === '..') {
        return {
          path: field,
          message: `${at} has an empty, "." or ".." segment (percent-encoded ones included), or a bad percent-encoding.`,
          fix: 'Remove double slashes and dot segments, and write a literal "%" as "%25".',
        };
      }
    }
  }
  // The dashboard writes the query back the way URLSearchParams writes it.
  const written = new URLSearchParams(
    queryAt === -1 ? '' : value.slice(queryAt + 1),
  ).toString();
  if (written !== '' && written.length + 1 > BRIDGE_LIMITS.queryMaxLength) {
    return {
      path: field,
      message: `${at} has a query of ${written.length + 1} characters once written the way the dashboard writes it (URLSearchParams); at most ${BRIDGE_LIMITS.queryMaxLength}.`,
      fix: 'Shorten the query; keep large state on your server.',
    };
  }
  return null;
}

/** A field that is absent, or a boolean. */
function optionalBoolean(
  call: BridgeCall,
  fields: Fields,
  field: string,
  into: Fields,
): PayloadProblem | null {
  const value = fields[field];
  if (value === undefined) return null;
  if (typeof value !== 'boolean') {
    return {
      path: field,
      message: `${call}: ${field} must be true or false when given.`,
      fix: `Pass ${field} as a boolean, or leave it out.`,
    };
  }
  into[field] = value;
  return null;
}

/** A field that is absent (`undefined` or `null`), or one of `values`. */
function optionalChoice(
  call: BridgeCall,
  fields: Fields,
  field: string,
  values: readonly string[],
  into: Fields,
): PayloadProblem | null {
  const value = fields[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !values.includes(value)) {
    return {
      path: field,
      message: `${call}: ${field} must be one of ${list(values)}.`,
      fix: `Pass one of ${list(values)}, or leave ${field} out.`,
    };
  }
  into[field] = value;
  return null;
}

const done = (found: PayloadProblem | null, payload: Fields): BuiltPayload =>
  found ? { ok: false, ...found } : { ok: true, payload };

/**
 * The payload to post for `call`, or why the dashboard would refuse it
 * (`INVALID_PAYLOAD`). Calls without a payload always get `{}`.
 */
export function buildPayload(call: BridgeCall, input: unknown): BuiltPayload {
  if (
    call === 'idToken' ||
    call === 'modal.close' ||
    call === 'saveBar.hide' ||
    call === 'context.get'
  ) {
    return { ok: true, payload: {} };
  }
  const given = input === undefined ? {} : input;
  if (!isFields(given)) {
    return problem(
      null,
      `${call}: the payload must be an object.`,
      `Pass an object, like ${call === 'toast.show' ? '{ message: "Saved" }' : '{ … }'}.`,
    );
  }
  const out: Fields = {};
  switch (call) {
    case 'toast.show': {
      const text = textProblem(
        call,
        'message',
        given['message'],
        BRIDGE_LIMITS.toastShownLength,
      );
      if (text) return done(text, out);
      out['message'] = given['message'];
      return done(optionalChoice(call, given, 'tone', TOAST_TONES, out), out);
    }

    case 'modal.open': {
      const path = appPathProblem(call, given['path']);
      if (path) return done(path, out);
      out['path'] = given['path'];
      const title = given['title'];
      if (title !== undefined && title !== null) {
        const text = textProblem(
          call,
          'title',
          title,
          BRIDGE_LIMITS.titleShownLength,
        );
        if (text) return done(text, out);
        out['title'] = title;
      }
      return done(optionalChoice(call, given, 'size', MODAL_SIZES, out), out);
    }

    case 'navigate': {
      const hasPath = given['path'] !== undefined;
      const hasDashboard = given['dashboard'] !== undefined;
      if (hasPath === hasDashboard) {
        return problem(
          hasPath ? 'dashboard' : null,
          `${call}: pass exactly one of path (a page of the app) and dashboard (a dashboard page).`,
          'Pass { path: "/…" } to move inside the app, or { dashboard: "orders" } to leave it.',
        );
      }
      if (hasPath) {
        const path = appPathProblem(call, given['path']);
        if (path) return done(path, out);
        out['path'] = given['path'];
        return done(optionalBoolean(call, given, 'replace', out), out);
      }
      const to = given['dashboard'];
      if (
        typeof to !== 'string' ||
        !(DASHBOARD_DESTINATIONS as readonly string[]).includes(to)
      ) {
        return problem(
          'dashboard',
          `${call}: dashboard must be one of ${list(DASHBOARD_DESTINATIONS)}.`,
          'Pick one of the listed dashboard pages; anything else cannot be opened.',
        );
      }
      out['dashboard'] = to;
      const id = given['id'];
      if (to === 'order' || to === 'customer') {
        if (typeof id !== 'string' || !RECORD_ID.test(id)) {
          return problem(
            'id',
            `${call}: dashboard "${to}" needs an id of 1-64 characters of [A-Za-z0-9_-].`,
            `Pass the ${to}'s id as the Admin API returns it.`,
          );
        }
        out['id'] = id;
      } else if (id !== undefined) {
        return problem(
          'id',
          `${call}: dashboard "${to}" takes no id.`,
          'Leave id out; only "order" and "customer" take one.',
        );
      }
      return done(null, out);
    }

    case 'saveBar.show':
      return done(optionalBoolean(call, given, 'saving', out), out);

    case 'titleBar.set': {
      const title = given['title'];
      if (title === null || title === '') {
        out['title'] = null;
        return done(null, out);
      }
      if (title === undefined) {
        return problem(
          'title',
          `${call}: title is required.`,
          'Pass the title as text, or null to clear it.',
        );
      }
      const text = textProblem(
        call,
        'title',
        title,
        BRIDGE_LIMITS.titleShownLength,
      );
      if (text) return done(text, out);
      out['title'] = title;
      return done(null, out);
    }

    case 'resource.pick': {
      const type = given['type'];
      if (
        typeof type !== 'string' ||
        !(PICK_TYPES as readonly string[]).includes(type)
      ) {
        return problem(
          'type',
          `${call}: type must be one of ${list(PICK_TYPES)}.`,
          `Pass { type: "product" } (or ${list(PICK_TYPES.slice(1))}).`,
        );
      }
      out['type'] = type;
      return done(optionalBoolean(call, given, 'multiple', out), out);
    }
  }
}
