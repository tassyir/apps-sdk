import { lines } from '../command.js';
import type { Command, CommandResult } from '../command.js';
import { checkManifest, loadManifest } from '../manifest.js';

// The commands that wait for the platform. `dev` prints the checklist for an
// app on your own server (tunnels stay the developer's choice); `logs --tail`
// needs Tassyir Hosting (AP-B1.14 to B1.16); `submit` is Phase 2 (public
// distribution and review, AP-B2.2). Each keeps its name and its seam.

interface Step {
  step: number;
  title: string;
  command?: string;
  note?: string;
}

export const devCommand: Command = {
  name: 'dev',
  summary: 'The checklist to run an app on your own server against a dev store',
  usage: 'tassyir dev [options]',
  description: [
    'Prints the steps, filled in from ./tassyir.app.toml when there is one. Tassyir does not',
    'run a tunnel for you yet: use the one you prefer.',
  ].join('\n'),
  options: {},
  async run(context): Promise<CommandResult> {
    const loaded = await loadManifest(context.io.cwd).catch(() => undefined);
    const check = loaded ? checkManifest(loaded.parsed) : undefined;
    const manifest = check?.ok ? check.manifest : undefined;
    const handle = manifest?.handle ?? '<handle>';
    const url =
      manifest?.hosting.mode === 'external' ? manifest.hosting.url : undefined;
    const placeholder =
      url !== undefined && /(^|\.)example\.com$/.test(new URL(url).hostname);
    const hosted = manifest?.hosting.mode === 'tassyir';
    const topic = manifest?.webhooks[0]?.topics[0] ?? 'orders/created';

    const steps: Step[] = [
      {
        step: 1,
        title: 'Start your server',
        command: 'npm run dev',
        note: 'The starter listens on port 3000.',
      },
      {
        step: 2,
        title:
          'Give it a public https address on port 443, with the tunnel you prefer',
        command: 'cloudflared tunnel --url http://localhost:3000',
        note: 'Or ngrok, or any other. A hostname that stays the same (a named tunnel, a reserved domain) saves a new version and a new consent each time it changes.',
      },
      {
        step: 3,
        title:
          'Put that address in tassyir.app.toml: [hosting] url = "https://…"',
        ...(url === undefined
          ? {}
          : {
              note: placeholder
                ? `Now ${url}: still the placeholder.`
                : `Now ${url}.`,
            }),
      },
      {
        step: 4,
        title: 'Check and upload it as a new version',
        command: 'tassyir deploy',
      },
      {
        step: 5,
        title: 'Have a dev store to install on',
        command: 'tassyir store create',
        note: '`tassyir store list` shows the ones you have (3 at most).',
      },
      {
        step: 6,
        title:
          'Install the app on the dev store, or accept the update after each deploy',
        note: "From the app's page in the developer console (its install link), then in the dev store: Apps → Installed apps → Update.",
      },
      {
        step: 7,
        title: 'Send a test webhook',
        command: `tassyir webhook trigger ${topic}`,
      },
    ];
    const notes = [
      ...(loaded === undefined
        ? [
            "No tassyir.app.toml here: run this in your app's folder, or start one with `tassyir app init`.",
          ]
        : check && !check.ok
          ? [
              'tassyir.app.toml does not pass validation: `tassyir validate` lists the problems.',
            ]
          : []),
      ...(hosted
        ? [
            'This app is set to Tassyir Hosting (hosting.mode = "tassyir"), which is not open yet: use mode "external" and your own server for now.',
          ]
        : []),
    ];
    return {
      data: {
        available: 'checklist',
        handle: manifest?.handle ?? null,
        hostingUrl: url ?? null,
        steps,
        notes,
      },
      text: lines(
        `tassyir dev, for now a checklist (${handle}):`,
        ...steps.flatMap((item) => [
          `  ${String(item.step)}. ${item.title}${item.command ? `\n       ${item.command}` : ''}`,
          ...(item.note ? [`       ${item.note}`] : []),
        ]),
        ...notes.map((note) => `! ${note}`),
      ),
    };
  },
};

export const logsCommand: Command = {
  name: 'logs',
  summary: "Stream a hosted app's logs (needs Tassyir Hosting)",
  usage: 'tassyir logs --tail',
  options: { tail: { type: 'boolean', description: 'Follow new lines.' } },
  unavailable: {
    reason:
      '`logs --tail` streams logs of apps on Tassyir Hosting, which is not open yet',
    fix: 'An app on your own server writes its own logs: read them where it runs. For deliveries, `tassyir webhook deliveries`.',
  },
  run() {
    return Promise.reject(new Error('unavailable'));
  },
};

export const submitCommand: Command = {
  name: 'submit',
  summary: 'Submit an app for review and public listing (Phase 2)',
  usage: 'tassyir submit',
  options: {},
  unavailable: {
    reason: 'public listing and review open with the marketplace (Phase 2)',
    fix: 'Custom apps need no review: install yours on your own businesses, or the one named with `tassyir app create --custom-business`.',
  },
  run() {
    return Promise.reject(new Error('unavailable'));
  },
};
