// The page's calls to its own Worker (src/app.ts), on the same origin. No
// token: on Tassyir Hosting the dashboard opened a session for this frame,
// and the Worker learns who is looking from ctx.props.viewer. Nothing in the
// page's address says who is looking, and the page never holds a Tassyir
// credential.

export interface Order {
  id: string;
  orderNumber: string;
  /** A decimal string ("2500.00"), never a number. */
  total: string | null;
  currency: string;
  createdAt: string;
}

export interface OrdersAnswer {
  orders: Order[];
  more: boolean;
  /** Orders the orders/created webhook announced since the install. */
  received: number;
}

export interface Settings {
  highlightFrom: string | null;
}

/** What the Worker answers when a call fails: a code, and a fix for you. */
export class ApiError extends Error {
  readonly code: string;
  readonly fix: string | undefined;

  constructor(code: string, message: string, fix: string | undefined) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fix = fix;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = isRecord(body) ? body : {};
    throw new ApiError(
      typeof problem['code'] === 'string'
        ? problem['code']
        : `HTTP_${String(response.status)}`,
      typeof problem['message'] === 'string'
        ? problem['message']
        : `${path} answered ${String(response.status)}`,
      typeof problem['fix'] === 'string' ? problem['fix'] : undefined,
    );
  }
  return body as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
