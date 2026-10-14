// @vitest-environment happy-dom
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createAppBridge, type AppBridge } from './bridge.js';
import { AppBridgeError } from './errors.js';
import {
  FakeHost,
  type HostParse,
  type HostProtocol,
  type RateVerdict,
} from './fake-host.test-harness.js';
import {
  PAYLOAD_CASES,
  pathCorpus,
  textCorpus,
  type PayloadCase,
} from './payload-corpus.test-harness.js';
import { buildPayload } from './payloads.js';
import {
  BRIDGE_CALLS,
  BRIDGE_EVENTS,
  BRIDGE_LIMITS,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_RATE_LIMITS,
  BRIDGE_TOTAL_RATE_LIMIT,
  DASHBOARD_DESTINATIONS,
  DASHBOARD_ERROR_CODES,
  MODAL_FRAME_CALLS,
  PICK_TYPES,
  type BridgeCall,
} from './protocol.js';

/**
 * This package against the dashboard's own bridge host code (AP-K1.4).
 * Skipped unless TASSYIR_FRONTEND_DIR names a tassyir/frontend clone; the
 * frontend repo is private, so CI cannot run it:
 *
 *   git -C ../frontend fetch origin
 *   TASSYIR_FRONTEND_DIR=../frontend npm run crosscheck -w @tassyir/app-bridge
 *
 * It reads `lib/apps/bridge-protocol.ts` and `lib/apps/app-frame.ts` at
 * TASSYIR_FRONTEND_REF (default `origin/main`) with `git show` (the checkout
 * is never switched), transpiles them with this repo's TypeScript, and runs
 * the dashboard's real reader (`parseBridgeMessage`), acceptance
 * (`acceptedFrame`), reply and event builders, rate limiter, context and pick
 * views against what this SDK sends:
 *  - the constants (calls, events, codes, destinations, caps, rate limits);
 *  - the payload verdicts: every case of the corpus, and generated text and
 *    path corpora, read by `buildPayload` and by `parseBridgeMessage`. What
 *    the SDK posts must read as a call; what it refuses, the dashboard must
 *    refuse too; and the SDK's rebuilt payload must mean the same as the input;
 *  - the SDK end to end in happy-dom against a host made of those functions:
 *    every call, every refusal code, context, events, picks, rate limits and
 *    the pagehide duty. Every message the SDK posts must read as a call.
 */

const FRONTEND_DIR = process.env['TASSYIR_FRONTEND_DIR'];
const FRONTEND_REF = process.env['TASSYIR_FRONTEND_REF'] ?? 'origin/main';

if (
  FRONTEND_DIR === undefined &&
  process.env['npm_lifecycle_event'] === 'crosscheck'
) {
  throw new Error(
    'TASSYIR_FRONTEND_DIR is not set. Set it to a tassyir/frontend clone (git fetch origin first), e.g. TASSYIR_FRONTEND_DIR=../frontend npm run crosscheck -w @tassyir/app-bridge.',
  );
}

type Fields = Record<string, unknown>;

/** What this check uses of `lib/apps/bridge-protocol.ts`. */
interface FrontendProtocol {
  BRIDGE_PROTOCOL_VERSION: number;
  BRIDGE_CALLS: readonly string[];
  BRIDGE_HOST_EVENTS: readonly string[];
  BRIDGE_ERROR_CODES: readonly string[];
  DASHBOARD_DESTINATIONS: readonly string[];
  PICK_RESOURCES: readonly string[];
  MODAL_FRAME_CALLS: ReadonlySet<string>;
  BRIDGE_RATE_LIMITS: Readonly<
    Record<string, { limit: number; windowMs: number }>
  >;
  BRIDGE_TOTAL_LIMIT: { limit: number; windowMs: number };
  BRIDGE_TOAST_MAX: number;
  BRIDGE_TITLE_MAX: number;
  BRIDGE_TEXT_HARD_MAX: number;
  BRIDGE_PATH_MAX: number;
  BRIDGE_PICK_MAX: number;
  acceptedFrame: HostProtocol['accepted'];
  parseBridgeMessage(data: unknown): HostParse;
  bridgeReply(re: string, payload: unknown): unknown;
  bridgeError(re: string, code: string): unknown;
  bridgeEvent(type: string, payload: unknown, id: string): unknown;
  createBridgeRateLimiter(): {
    take(call: string | null, now: number): RateVerdict;
  };
  bridgeContext(input: {
    locale: string;
    theme: string | null;
    storeId: string | null;
    access: { storeAccess: 'all' | 'selected'; storeIds: string[] };
  }): unknown;
  pickedSelection(
    rows: readonly Fields[],
    view: (row: Fields) => unknown,
  ): unknown[];
  pickedProductView(row: Fields): unknown;
  pickedCollectionView(row: Fields): unknown;
  pickedCustomerView(row: Fields, contact: boolean): unknown;
  parseIdTokenResponse(
    raw: unknown,
    now: number,
  ): { token: string; expiresAt: number } | null;
  idTokenStillValid(
    minted: { token: string; expiresAt: number },
    now: number,
  ): boolean;
}

const git = (...args: string[]) =>
  execFileSync('git', ['-C', FRONTEND_DIR ?? '.', ...args], {
    encoding: 'utf8',
  });

let fe: FrontendProtocol;
let scratch: string | undefined;

/** The dashboard's host functions as the fake host's protocol. */
const frontendProtocol = (): HostProtocol => ({
  accepted: (event, frames, appOrigin) =>
    fe.acceptedFrame(event, frames, appOrigin),
  parse: (data) => fe.parseBridgeMessage(data),
  reply: (re, payload) => fe.bridgeReply(re, payload),
  error: (re, code) => fe.bridgeError(re, code),
  event: (type, payload, id) => fe.bridgeEvent(type, payload, id),
  createLimiter: () => fe.createBridgeRateLimiter(),
  modalCalls: fe.MODAL_FRAME_CALLS,
  pickSelection: (type, rows, contact) =>
    fe.pickedSelection(rows, (row) =>
      type === 'product'
        ? fe.pickedProductView(row)
        : type === 'collection'
          ? fe.pickedCollectionView(row)
          : fe.pickedCustomerView(row, contact),
    ),
  context: ({ locale, theme, storeId }) =>
    fe.bridgeContext({
      locale,
      theme,
      storeId,
      access: { storeAccess: 'all', storeIds: [] },
    }),
  mintIdToken(n, now) {
    const minted = fe.parseIdTokenResponse(
      {
        data: {
          token: `eyJhbGciOiJFZERTQSJ9.eyJqdGkiOiJ${String(n)}In0.c2ln`,
          expiresIn: 60,
        },
      },
      now,
    );
    return minted && fe.idTokenStillValid(minted, now) ? minted.token : null;
  },
});

const envelope = (type: string, payload: unknown) => ({
  tsy: 1,
  id: 'crosscheck-1',
  type,
  payload,
});

const show = (value: unknown) => {
  const text = JSON.stringify(value, (_, inner: unknown) =>
    inner === undefined ? '<undefined>' : inner,
  );
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
};

/** Where the SDK and the dashboard disagree about one input, or null. */
function disagreement(testCase: PayloadCase): string | null {
  const { call, input } = testCase;
  const built = buildPayload(call, input);
  const raw = fe.parseBridgeMessage(envelope(call, input));
  const where = `${call} ${show(input)}`;
  if (!built.ok) {
    return raw.kind === 'invalid'
      ? null
      : `${where}: the SDK refuses it (${built.message}) but the dashboard reads ${raw.kind}`;
  }
  const wire = fe.parseBridgeMessage(envelope(call, built.payload));
  if (wire.kind !== 'call') {
    return `${where}: the SDK posts ${show(built.payload)}, which the dashboard reads ${wire.kind}`;
  }
  if (testCase.undefinedField) return null;
  if (raw.kind !== 'call') {
    return `${where}: the SDK posts it, the dashboard refuses the input as given`;
  }
  return JSON.stringify(wire) === JSON.stringify(raw)
    ? null
    : `${where}: the SDK's rebuilt payload reads ${show(wire)}, the input reads ${show(raw)}`;
}

describe.skipIf(FRONTEND_DIR === undefined)(
  `the SDK against the dashboard's bridge host (${FRONTEND_REF})`,
  () => {
    beforeAll(async () => {
      const commit = git('rev-parse', '--short', FRONTEND_REF).trim();
      console.info(`frontend ${FRONTEND_REF} = ${commit}`);
      // Inside the repo (git-ignored): Vite imports nothing outside its root.
      const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
      }).trim();
      const cache = join(repo, 'node_modules', '.cache');
      mkdirSync(cache, { recursive: true });
      scratch = mkdtempSync(join(cache, 'app-bridge-crosscheck-'));
      for (const name of ['app-frame', 'bridge-protocol']) {
        const source = git('show', `${FRONTEND_REF}:lib/apps/${name}.ts`);
        const { outputText } = ts.transpileModule(source, {
          fileName: `${name}.ts`,
          compilerOptions: {
            module: ts.ModuleKind.ES2022,
            target: ts.ScriptTarget.ES2022,
          },
        });
        writeFileSync(
          join(scratch, `${name}.mjs`),
          outputText.replace(
            /from\s+["']\.\/app-frame["']/g,
            'from "./app-frame.mjs"',
          ),
        );
      }
      fe = (await import(
        /* @vite-ignore */ join(scratch, 'bridge-protocol.mjs')
      )) as FrontendProtocol;
    });

    afterAll(() => {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    });

    it('states the same contract: calls, events, codes, destinations, caps and rate limits', () => {
      expect(fe.BRIDGE_PROTOCOL_VERSION).toBe(BRIDGE_PROTOCOL_VERSION);
      expect([...fe.BRIDGE_CALLS]).toEqual(BRIDGE_CALLS);
      expect([...fe.BRIDGE_HOST_EVENTS]).toEqual(BRIDGE_EVENTS);
      expect([...fe.BRIDGE_ERROR_CODES]).toEqual(DASHBOARD_ERROR_CODES);
      expect([...fe.DASHBOARD_DESTINATIONS]).toEqual(DASHBOARD_DESTINATIONS);
      expect([...fe.PICK_RESOURCES]).toEqual(PICK_TYPES);
      expect([...fe.MODAL_FRAME_CALLS].sort()).toEqual(
        [...MODAL_FRAME_CALLS].sort(),
      );
      expect(
        Object.fromEntries(
          Object.entries(fe.BRIDGE_RATE_LIMITS).map(([call, rule]) => [
            call,
            rule.limit,
          ]),
        ),
      ).toEqual(BRIDGE_RATE_LIMITS);
      for (const rule of Object.values(fe.BRIDGE_RATE_LIMITS)) {
        expect(rule.windowMs).toBe(60_000);
      }
      expect(fe.BRIDGE_TOTAL_LIMIT).toEqual({
        limit: BRIDGE_TOTAL_RATE_LIMIT,
        windowMs: 60_000,
      });
      expect({
        toast: fe.BRIDGE_TOAST_MAX,
        title: fe.BRIDGE_TITLE_MAX,
        text: fe.BRIDGE_TEXT_HARD_MAX,
        path: fe.BRIDGE_PATH_MAX,
        pick: fe.BRIDGE_PICK_MAX,
      }).toEqual({
        toast: BRIDGE_LIMITS.toastShownLength,
        title: BRIDGE_LIMITS.titleShownLength,
        text: BRIDGE_LIMITS.textMaxLength,
        path: BRIDGE_LIMITS.pathMaxLength,
        pick: BRIDGE_LIMITS.pickMaxItems,
      });
    });

    it('reads every payload of the corpus the way the dashboard does', () => {
      const found = PAYLOAD_CASES.map(disagreement).filter(Boolean);
      expect(found).toEqual([]);
      // And the corpus's own verdicts are the dashboard's.
      for (const testCase of PAYLOAD_CASES) {
        if (testCase.undefinedField) continue;
        const raw = fe.parseBridgeMessage(
          envelope(testCase.call, testCase.input),
        );
        expect([testCase.call, testCase.input, raw.kind]).toEqual([
          testCase.call,
          testCase.input,
          testCase.valid ? 'call' : 'invalid',
        ]);
      }
    });

    it('reads generated text the way the dashboard does (toasts, titles)', () => {
      const cases: PayloadCase[] = textCorpus().flatMap((text) => [
        { call: 'toast.show', input: { message: text }, valid: true },
        { call: 'titleBar.set', input: { title: text }, valid: true },
        { call: 'modal.open', input: { path: '/x', title: text }, valid: true },
      ]);
      expect(cases.length).toBeGreaterThan(1500);
      expect(cases.map(disagreement).filter(Boolean)).toEqual([]);
    });

    it('reads generated app paths the way the dashboard does (navigate, modal.open)', () => {
      const cases: PayloadCase[] = pathCorpus().flatMap((path) => [
        { call: 'navigate', input: { path }, valid: true },
        { call: 'modal.open', input: { path }, valid: true },
      ]);
      expect(cases.length).toBeGreaterThan(20_000);
      const refused = cases.filter(
        ({ call, input }) => !buildPayload(call, input).ok,
      ).length;
      // Both verdicts are well represented.
      expect(refused).toBeGreaterThan(cases.length / 4);
      expect(refused).toBeLessThan(cases.length);
      expect(cases.map(disagreement).filter(Boolean)).toEqual([]);
    });

    describe('end to end, in happy-dom', () => {
      let host: FakeHost | undefined;
      let bridge: AppBridge | undefined;

      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        bridge?.destroy();
        bridge = undefined;
        host?.remove();
        host = undefined;
        vi.useRealTimers();
      });

      const flush = async () => {
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      };
      const start = (frame: 'page' | 'modal' = 'page') => {
        const fake = new FakeHost({ protocol: frontendProtocol(), frame });
        host = fake;
        const created = createAppBridge();
        bridge = created;
        return { host: fake, bridge: created };
      };
      const everyMessageReadAsACall = (fake: FakeHost) => {
        expect(fake.read.length).toBe(fake.posted.length);
        for (const { parse, verdict } of fake.read) {
          expect([parse.kind, verdict]).toEqual(['call', 'ok']);
        }
      };

      it('makes every call; the dashboard reads each as a call and its answers read back', async () => {
        const { host, bridge } = start();
        await flush();
        expect(host.ready).toBe(true);
        expect(bridge.context.current).toEqual({
          locale: 'ar',
          dir: 'rtl',
          theme: 'light',
          storeId: 'store_1',
        });

        const { token } = await bridge.idToken();
        expect(token).toBe(host.minted[0]);
        await bridge.toast.show({ message: 'Saved', tone: 'success' });
        await bridge.titleBar.set({ title: 'Reviews' });
        expect(host.title).toBe('Reviews');
        await bridge.saveBar.show({ saving: true });
        expect(host.saveBar).toEqual({ saving: true });
        await bridge.saveBar.hide();
        await bridge.navigate({ path: '/reviews/2?tab=sent', replace: true });
        await bridge.navigate({ dashboard: 'customer', id: 'c_1' });
        expect(host.navigations).toEqual([
          {
            kind: 'app',
            replace: true,
            subPath: '/reviews/2',
            search: '?tab=sent',
          },
          { kind: 'dashboard', to: 'customer', id: 'c_1' },
        ]);
        const modal = bridge.modal.open({
          path: '/edit',
          title: 'Edit',
          size: 'small',
        });
        await flush();
        await bridge.modal.close();
        await expect(modal).resolves.toEqual({ closedBy: 'app' });
        await expect(bridge.context.get()).resolves.toEqual(
          bridge.context.current,
        );

        const pick = bridge.resource.pick({ type: 'product', multiple: true });
        await flush();
        const rows = [
          {
            id: 'p1',
            name: 'Shirt',
            image: 'https://cdn.example/a.png',
            price: '2500.00',
          },
          { id: 'p2', name: 'Hat', image: 'http://insecure.example/b.png' },
          { id: 'not an id', name: 'dropped' },
        ];
        host.settlePick(rows);
        await expect(pick).resolves.toEqual({
          selection: fe.pickedSelection(rows, (row) =>
            fe.pickedProductView(row),
          ),
        });

        for (const contact of [false, true]) {
          host.contact = contact;
          const customers = bridge.resource.pick({ type: 'customer' });
          await flush();
          const people = [
            {
              id: 'c1',
              provinceCode: 16,
              name: 'Amina',
              phone: '0555',
              email: 'x',
            },
          ];
          host.settlePick(people);
          await expect(customers).resolves.toEqual({
            selection: fe.pickedSelection(people, (row) =>
              fe.pickedCustomerView(row, contact),
            ),
          });
        }
        everyMessageReadAsACall(host);
      });

      it('posts every valid payload of the corpus as a call', async () => {
        const { host, bridge } = start();
        await flush();
        const methods: Record<
          BridgeCall,
          (input: unknown) => Promise<unknown>
        > = {
          idToken: () => bridge.idToken(),
          'toast.show': (input) => bridge.toast.show(input as never),
          'modal.open': async (input) => {
            const opened = bridge.modal.open(input as never);
            await flush();
            host.closeModal('merchant');
            return opened;
          },
          'modal.close': () => bridge.modal.close().catch(() => undefined),
          navigate: (input) => bridge.navigate(input as never),
          'saveBar.show': (input) => bridge.saveBar.show(input as never),
          'saveBar.hide': () => bridge.saveBar.hide(),
          'titleBar.set': (input) => bridge.titleBar.set(input as never),
          'resource.pick': async (input) => {
            const picked = bridge.resource.pick(input as never);
            await flush();
            host.settlePick();
            return picked;
          },
          'context.get': () => bridge.context.get(),
        };
        for (const testCase of PAYLOAD_CASES.filter(({ valid }) => valid)) {
          await methods[testCase.call](testCase.input);
          // Stay inside every per-minute limit.
          await vi.advanceTimersByTimeAsync(6_000);
        }
        everyMessageReadAsACall(host);
      });

      it('reads every error code the dashboard builds', async () => {
        const { host, bridge } = start();
        await flush();
        for (const code of fe.BRIDGE_ERROR_CODES) {
          host.respond('context.get', () => ({ error: code }));
          const error = await bridge.context
            .get()
            .catch((caught: unknown) => caught);
          expect(error).toBeInstanceOf(AppBridgeError);
          expect(error).toMatchObject({ code, source: 'dashboard' });
        }
      });

      it('reads every context and event the dashboard builds', async () => {
        const { host, bridge } = start();
        await flush();
        const save = vi.fn();
        const discard = vi.fn();
        bridge.on('saveBar.save', save);
        bridge.on('saveBar.discard', discard);
        for (const locale of ['ar', 'en', 'fr']) {
          for (const theme of ['light', 'dark', 'system']) {
            for (const storeId of ['store_1', null]) {
              host.setContext({ locale, theme, storeId });
              await flush();
              expect(bridge.context.current).toEqual(
                fe.bridgeContext({
                  locale,
                  theme,
                  storeId,
                  access: { storeAccess: 'all', storeIds: [] },
                }),
              );
            }
          }
        }
        host.push('saveBar.save', {});
        host.push('saveBar.discard', {});
        await flush();
        expect(save).toHaveBeenCalledTimes(1);
        expect(discard).toHaveBeenCalledTimes(1);
      });

      it('refuses on its own exactly where the dashboard limiter would, so the dashboard never drops', async () => {
        const { host, bridge } = start();
        await flush();
        const outcomes: string[] = [];
        for (let i = 0; i < 25; i += 1) {
          outcomes.push(
            await bridge.toast.show({ message: String(i) }).then(
              () => 'ok',
              (error: unknown) => (error as AppBridgeError).source,
            ),
          );
        }
        expect(outcomes).toEqual([
          ...Array<string>(20).fill('ok'),
          ...Array<string>(5).fill('sdk'),
        ]);
        for (let i = 0; i < 59; i += 1) await bridge.context.get();
        for (let i = 0; i < 60; i += 1) {
          await bridge.saveBar.show();
          await bridge.saveBar.hide();
        }
        for (let i = 0; i < 40; i += 1)
          await bridge.titleBar.set({ title: String(i) });
        await expect(
          bridge.titleBar.set({ title: 'over' }),
        ).rejects.toMatchObject({
          code: 'RATE_LIMITED',
          source: 'sdk',
        });
        expect(host.read).toHaveLength(BRIDGE_TOTAL_RATE_LIMIT);
        everyMessageReadAsACall(host);
      });

      it('clears the title and the save bar on pagehide with calls the dashboard reads', async () => {
        const { host, bridge } = start();
        await bridge.titleBar.set({ title: 'Reviews' });
        await bridge.saveBar.show();
        const event = new Event('pagehide');
        Object.defineProperty(event, 'persisted', { value: false });
        window.dispatchEvent(event);
        await flush();
        expect(host.title).toBeNull();
        expect(host.saveBar).toBeNull();
        everyMessageReadAsACall(host);
      });

      it('gets NOT_ALLOWED_HERE from a modal frame for the page-only calls', async () => {
        const { bridge } = start('modal');
        await flush();
        for (const call of BRIDGE_CALLS) {
          if (MODAL_FRAME_CALLS.includes(call)) continue;
          const attempt =
            call === 'navigate'
              ? bridge.navigate({ dashboard: 'home' })
              : call === 'modal.open'
                ? bridge.modal.open({ path: '/x' })
                : call === 'titleBar.set'
                  ? bridge.titleBar.set({ title: null })
                  : call === 'saveBar.show'
                    ? bridge.saveBar.show()
                    : bridge.saveBar.hide();
          await expect(attempt).rejects.toMatchObject({
            code: 'NOT_ALLOWED_HERE',
          });
        }
      });
    });
  },
);
