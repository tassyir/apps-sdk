/**
 * The dashboard tells an app's page its language, direction and theme through
 * App Bridge (`context.changed`). These helpers put them on the page: `lang`,
 * `dir` and `data-theme` on `<html>`, which the tokens and every element
 * follow. They take `@tassyir/app-bridge`'s bridge as it is, without
 * importing it: any object of the same shape works.
 */

/** What the page needs from App Bridge's context. */
export interface DashboardContext {
  locale: string;
  dir: 'rtl' | 'ltr';
  theme: 'light' | 'dark';
}

/** The part of an App Bridge (`createAppBridge()`) these helpers use. */
export interface DashboardContextSource {
  readonly context: { readonly current: DashboardContext | null };
  on(
    event: 'context.changed',
    listener: (context: DashboardContext) => void,
  ): () => void;
}

/**
 * Sets `lang`, `dir` and `data-theme` on `root` (default: `<html>`). A field
 * that is missing is left as it is.
 */
export function applyDashboardContext(
  context: Partial<DashboardContext>,
  root: HTMLElement = document.documentElement,
): void {
  if (context.locale) root.setAttribute('lang', context.locale);
  if (context.dir === 'rtl' || context.dir === 'ltr') {
    root.setAttribute('dir', context.dir);
  }
  if (context.theme === 'light' || context.theme === 'dark') {
    root.setAttribute('data-theme', context.theme);
  }
}

/**
 * Applies the dashboard's context now (when the bridge has one) and on every
 * `context.changed`. Returns the function that stops following.
 *
 * ```ts
 * import { createAppBridge } from '@tassyir/app-bridge';
 * import { followDashboardContext } from '@tassyir/ui';
 *
 * const bridge = createAppBridge();
 * followDashboardContext(bridge);
 * ```
 */
export function followDashboardContext(
  bridge: DashboardContextSource,
  root?: HTMLElement,
): () => void {
  const apply = (context: DashboardContext): void => {
    applyDashboardContext(context, root);
  };
  const current = bridge.context.current;
  if (current) apply(current);
  return bridge.on('context.changed', apply);
}
