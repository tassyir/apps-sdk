import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SDK_ERROR_CODES } from './errors.js';
import {
  BRIDGE_CALLS,
  BRIDGE_RATE_LIMITS,
  DASHBOARD_DESTINATIONS,
  DASHBOARD_ERROR_CODES,
  MODAL_FRAME_CALLS,
} from './protocol.js';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** The rows of the Markdown table under `heading`, as cells. */
function table(heading: string): string[][] {
  const section = README.split(/^## /m).find((part) =>
    part.startsWith(heading),
  );
  if (!section) throw new Error(`no "## ${heading}" section`);
  return section
    .split('\n')
    .filter((line) => line.startsWith('| ') && !/^\| -/.test(line))
    .slice(1)
    .map((line) =>
      line
        .slice(2, -2)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    );
}

describe('README', () => {
  it('lists every error code once, with who raises it', () => {
    const rows = table('Errors');
    expect(rows.map(([code]) => code)).toEqual(
      [...DASHBOARD_ERROR_CODES, ...SDK_ERROR_CODES].map(
        (code) => `\`${code}\``,
      ),
    );
    for (const [code, source] of rows) {
      const name = code?.slice(1, -1) ?? '';
      const fromDashboard = (
        DASHBOARD_ERROR_CODES as readonly string[]
      ).includes(name);
      expect([name, source?.startsWith('sdk') ? 'sdk' : source]).toEqual([
        name,
        fromDashboard
          ? ['INVALID_PAYLOAD', 'RATE_LIMITED', 'FAILED'].includes(name)
            ? 'both'
            : 'dashboard'
          : 'sdk',
      ]);
    }
  });

  it('gives the rate limits of the code', () => {
    expect(
      Object.fromEntries(
        table('How the bridge talks').map(([call, limit]) => [
          call?.slice(1, -1),
          Number(limit),
        ]),
      ),
    ).toEqual(BRIDGE_RATE_LIMITS);
  });

  it('documents every call, destination and modal call', () => {
    const calls = table('Calls').map(([call]) => call ?? '');
    for (const call of BRIDGE_CALLS) {
      expect(calls.some((cell) => cell.startsWith(`\`${call}(`))).toBe(true);
    }
    for (const destination of DASHBOARD_DESTINATIONS) {
      expect(README).toContain(`\`${destination}\``);
    }
    expect(README).toContain(
      MODAL_FRAME_CALLS.slice(0, -1)
        .map((call) => `\`${call}\``)
        .join(', ') +
        ` and \`${MODAL_FRAME_CALLS[MODAL_FRAME_CALLS.length - 1] ?? ''}\``,
    );
  });
});
