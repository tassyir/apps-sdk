import type { CliIo } from './io.js';

// Opens the approval page in the person's browser, only when they ask (Enter
// in a terminal). The address comes from the API; only http(s) is opened, so
// an odd answer can never launch another handler. No shell is involved.

/** True for an https address, or http on this machine (a local API). */
export function isBrowsableUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopback(url.hostname);
}

export function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

/** Opens `url`; false when it could not (no browser, no display). */
export async function openBrowser(io: CliIo, url: string): Promise<boolean> {
  if (!isBrowsableUrl(url)) return false;
  const [command, args] =
    io.platform === 'darwin'
      ? ['open', [url]]
      : io.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  const result = await io.exec(command, args, { timeoutMs: 10_000 });
  return result.code === 0;
}
