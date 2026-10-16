import { BLOCK_LIMITS, IMAGE_URL_WIDTHS } from './limits.js';

/** The one host a block's images and stylesheet images load from. */
export const IMAGE_CDN_ORIGIN = 'https://cdn.tassyir.io';

/** A stored image: `https://cdn.tassyir.io/images/<id>/<variant>`. */
const STORED_IMAGE =
  /^https:\/\/cdn\.tassyir\.io\/images\/([A-Za-z0-9_-]{1,128})\/[A-Za-z0-9_-]{1,64}$/;

/**
 * What `image_url` makes, and the only `<img src>` a block keeps: an edge-sized
 * copy in the storefront's own shape (the frontend's `cdnVariant`, quality 80),
 * at one of `IMAGE_URL_WIDTHS`.
 */
const SIZED_IMAGE =
  /^https:\/\/cdn\.tassyir\.io\/cdn-cgi\/image\/w=(\d{1,4}),q=80,fit=scale-down,f=auto\/images\/[A-Za-z0-9_-]{1,128}\/public$/;

/** The width `image_url` uses for a requested one: the next allowed width up. */
export function snapImageWidth(requested: number): number {
  for (const width of IMAGE_URL_WIDTHS) {
    if (requested <= width) return width;
  }
  return IMAGE_URL_WIDTHS[IMAGE_URL_WIDTHS.length - 1] ?? 1600;
}

/** `{{ image | image_url: 400 }}`, or '' when the input is not a Tassyir image. */
export function imageUrl(input: string, width: number): string {
  const id = STORED_IMAGE.exec(input)?.[1];
  if (id === undefined || !Number.isFinite(width) || width < 1) return '';
  return `${IMAGE_CDN_ORIGIN}/cdn-cgi/image/w=${snapImageWidth(Math.trunc(width)).toString()},q=80,fit=scale-down,f=auto/images/${id}/public`;
}

/** True for an `<img src>` a block may keep. */
export function isBlockImageSource(value: string): boolean {
  const match = SIZED_IMAGE.exec(value);
  return (
    match !== null &&
    (IMAGE_URL_WIDTHS as readonly number[]).includes(Number(match[1]))
  );
}

/** True for a stored image (an `image` setting, `product.image`). */
export function isStoredImage(value: string): boolean {
  return STORED_IMAGE.test(value);
}

/** Printable ASCII a link may hold: everything but space, quotes, angle
 * brackets, backslash and backtick. */
const LINK_ASCII = /^[!#$%&()*+,\-./0-9:;=?@A-Z[\]^_a-z{|}~]$/;

/**
 * Characters beyond ASCII a link may not hold: controls, every space and
 * format character (bidi marks and controls, zero-width characters, variation
 * selectors), fillers, separators, private use and noncharacters. Browsers
 * strip some of them from URLs, which is how `/\t/evil.example` becomes
 * `//evil.example`. A fixed list, not a Unicode property, so every engine
 * agrees.
 */
function isRefusedInLink(code: number): boolean {
  return (
    code <= 0xa0 ||
    code === 0xad ||
    code === 0x34f ||
    code === 0x61c ||
    code === 0x115f ||
    code === 0x1160 ||
    code === 0x1680 ||
    code === 0x17b4 ||
    code === 0x17b5 ||
    (code >= 0x180b && code <= 0x180f) ||
    (code >= 0x2000 && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202f) ||
    (code >= 0x205f && code <= 0x206f) ||
    code === 0x3000 ||
    code === 0x3164 ||
    (code >= 0xd800 && code <= 0xf8ff) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfeff ||
    code === 0xffa0 ||
    (code >= 0xfff0 && code <= 0xffff) ||
    (code >= 0x1d173 && code <= 0x1d17a) ||
    (code >= 0xe0000 && code <= 0xe0fff) ||
    code >= 0xf0000
  );
}

function hasOnlyLinkCharacters(value: string): boolean {
  for (let i = 0; i < value.length;) {
    const code = value.codePointAt(i) ?? 0;
    if (code < 0x80) {
      if (!LINK_ASCII.test(value[i] ?? '')) return false;
    } else if (isRefusedInLink(code)) return false;
    i += code > 0xffff ? 2 : 1;
  }
  return true;
}

const HTTPS_LINK = /^https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:[/?#]|$)/i;
const STORE_PATH = /^\/(?![/\\])/;
const FRAGMENT = /^#[A-Za-z0-9_-]*$/;

export type LinkKind = 'external' | 'store' | 'fragment';

/**
 * Where a block's link may go: an `https://` address on a named host (no
 * user, password or port), a path on the store (`/…`, never `//`), or a
 * `#fragment`. Anything else (`javascript:`, `data:`, `http:`, `mailto:`, a
 * relative path without `/`) is null.
 */
export function linkKind(value: string): LinkKind | null {
  if (value.length === 0 || value.length > BLOCK_LIMITS.attributeLength)
    return null;
  if (!hasOnlyLinkCharacters(value)) return null;
  if (FRAGMENT.test(value)) return 'fragment';
  if (STORE_PATH.test(value)) return 'store';
  if (HTTPS_LINK.test(value)) {
    // The authority ends at the first / ? #; it holds no @ (user) and no
    // port.
    const authority = value.slice(8).split(/[/?#]/, 1)[0] ?? '';
    return /^[A-Za-z0-9.-]+$/.test(authority) ? 'external' : null;
  }
  return null;
}

/**
 * A `url()` a block stylesheet may load: an image on Tassyir's CDN. The value
 * is the URL as written (quotes removed); it may not contain a quote, space,
 * backslash or bracket.
 */
export function isStylesheetUrl(value: string): boolean {
  return (
    /^https:\/\/cdn\.tassyir\.io\/[A-Za-z0-9\-._~/=,%]*$/.test(value) &&
    !value.includes('..')
  );
}
