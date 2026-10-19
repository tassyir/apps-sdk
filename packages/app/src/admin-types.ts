// Types of the Admin API, derived from the generated OpenAPI types
// (src/generated/admin-api.2026-10.ts). Nothing here exists at run time.

import type {
  components,
  operations,
  paths,
  webhooks,
} from './generated/admin-api.2026-10.js';

/** The raw generated types, for anything the aliases below do not name. */
export type {
  components as AdminApiComponents,
  operations as AdminApiOperations,
  paths as AdminApiRawPaths,
  webhooks as AdminApiWebhooks,
};

type Schemas = components['schemas'];

// The 2026-10 resources. Money fields are decimal strings ("2500.00"), never
// numbers: keep them strings, or use a decimal library, never parseFloat.
export type Business = Schemas['Business'];
export type Order = Schemas['Order'];
/** One line of an order. `unitPrice` and `totalPrice` are NET of discounts; `originalPrice` is the gross unit price. */
export type OrderItem = Order['items'][number];
/**
 * A discount an order got, grouped by title, code, class and source: on the
 * order (`Order['discounts']`) or on a line (`OrderItem['discounts']`).
 * `class: 'delivery'` is a shipping waiver and is not part of `discountTotal`.
 */
export type Discount = Order['discounts'][number];
export type OrderComment = Schemas['OrderComment'];
export type CancelReason = Schemas['CancelReason'];
export type Checkout = Schemas['Checkout'];
export type Product = Schemas['Product'];
export type ProductVariant = Schemas['ProductVariant'];
export type Collection = Schemas['Collection'];
export type InventoryLevel = Schemas['InventoryLevel'];
export type Customer = Schemas['Customer'];
export type Offer = Schemas['Offer'];
export type Store = Schemas['Store'];
export type DeliveryAgent = Schemas['DeliveryAgent'];
export type DeliveryFeeGroup = Schemas['DeliveryFeeGroup'];
export type AppData = Schemas['AppData'];
export type Installation = Schemas['Installation'];

type Prefix = '/apps/2026-10';

/** The Admin API's paths, relative to `/apps/2026-10` (`/orders/{id}`). */
export type AdminApiPaths = {
  [
    K in keyof paths as K extends `${Prefix}${infer Rest}` ? Rest : never
  ]: paths[K];
};
export type AdminPath = keyof AdminApiPaths;
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** The paths that answer `method`. */
export type PathsWithMethod<M extends HttpMethod> = {
  [P in AdminPath]: AdminApiPaths[P][M] extends { responses: unknown }
    ? P
    : never;
}[AdminPath];

export type AdminOperation<
  M extends HttpMethod,
  P extends PathsWithMethod<M>,
> = NonNullable<AdminApiPaths[P][M]>;

type SuccessStatus = 200 | 201 | 202 | 204;
type JsonContent<R> = R extends { content: { 'application/json': infer B } }
  ? B
  : never;

/** The JSON body of an operation's success answers. */
export type SuccessBody<O> = O extends { responses: infer R }
  ? {
      [S in keyof R]: S extends SuccessStatus ? JsonContent<R[S]> : never;
    }[keyof R]
  : never;

/** Every problem `code` an operation can answer, from the OpenAPI document. */
export type ErrorCodeOf<O> = O extends { responses: infer R }
  ? {
      [S in keyof R]: S extends SuccessStatus
        ? never
        : R[S] extends {
              content: { 'application/problem+json': { code?: infer C } };
            }
          ? Extract<C, string>
          : never;
    }[keyof R]
  : never;

/** `ErrorCodeOf` by method and path: `AdminApiErrorCode<'post', '/orders/{id}/confirm'>`. */
export type AdminApiErrorCode<
  M extends HttpMethod,
  P extends PathsWithMethod<M>,
> = ErrorCodeOf<AdminOperation<M, P>>;

export type PathParams<O> = O extends { parameters: { path: infer X } }
  ? X
  : never;
export type QueryParams<O> = O extends { parameters: { query?: infer Q } }
  ? NonNullable<Q>
  : never;
export type RequestBody<O> = O extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : never;

type ResourceOf<B> = B extends { data: infer D }
  ? D extends readonly (infer Item)[]
    ? Item
    : D
  : never;

/** The top-level field names `?fields=` accepts for an operation's resource. */
export type FieldName<O> = Extract<keyof ResourceOf<SuccessBody<O>>, string>;

type Query<O> = Omit<QueryParams<O>, 'fields'> &
  ('fields' extends keyof QueryParams<O>
    ? {
        /** Top-level fields to keep (`id` always is): names, or one comma-separated string. */
        fields?: string | readonly FieldName<O>[];
      }
    : unknown);

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** What a call takes besides its method and path. */
export type RequestOptions<
  M extends HttpMethod,
  P extends PathsWithMethod<M>,
> = Simplify<
  ([PathParams<AdminOperation<M, P>>] extends [never]
    ? { path?: never }
    : { path: PathParams<AdminOperation<M, P>> }) &
    ([QueryParams<AdminOperation<M, P>>] extends [never]
      ? { query?: never }
      : { query?: Query<AdminOperation<M, P>> }) &
    ([RequestBody<AdminOperation<M, P>>] extends [never]
      ? { body?: never }
      : { body: RequestBody<AdminOperation<M, P>> }) &
    (M extends 'get'
      ? unknown
      : {
          /**
           * `Idempotency-Key` for this write. Default: a new UUID per call,
           * reused by the SDK's own retries. `false` sends none.
           */
          idempotencyKey?: string | false;
        }) & {
      signal?: AbortSignal;
      /** Extra request headers. `Authorization` and `Idempotency-Key` are the SDK's. */
      headers?: Record<string, string>;
    }
>;

/** `[options]` when every option is optional, `[options?]` otherwise. */
export type RequestArgs<M extends HttpMethod, P extends PathsWithMethod<M>> =
  object extends RequestOptions<M, P>
    ? [options?: RequestOptions<M, P>]
    : [options: RequestOptions<M, P>];

export type ResponseBody<
  M extends HttpMethod,
  P extends PathsWithMethod<M>,
> = SuccessBody<AdminOperation<M, P>>;

/** The list paths (`{ data: [...], nextCursor }`), which `paginate` walks. */
export type ListPath = {
  [P in PathsWithMethod<'get'>]: SuccessBody<AdminOperation<'get', P>> extends {
    data: readonly unknown[];
    nextCursor: string | null;
  }
    ? P
    : never;
}[PathsWithMethod<'get'>];

export type ListItem<P extends ListPath> =
  SuccessBody<AdminOperation<'get', P>> extends {
    data: readonly (infer Item)[];
  }
    ? Item
    : never;

/** The webhook topics (`orders/created`, …). */
export type WebhookTopic = keyof webhooks;

type WebhookBody<T extends WebhookTopic> = webhooks[T]['post'] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** A webhook envelope (plan §3.7). Narrow it with `switch (event.type)`. */
export type WebhookEvent = {
  [T in WebhookTopic]: WebhookBody<T>;
}[WebhookTopic];

/** The envelope of one topic. */
export type WebhookEventOf<T extends WebhookTopic> = Extract<
  WebhookEvent,
  { type: T }
>;
