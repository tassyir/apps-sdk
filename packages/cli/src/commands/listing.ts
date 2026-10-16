import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { lines, resolveApp, stringValue } from '../command.js';
import type { Command } from '../command.js';
import type {
  DeveloperListing,
  ListingInput,
  ListingIssue,
} from '../developer-types.js';
import { CliError, EXIT_CODES } from '../errors.js';
import type { CliProblem } from '../errors.js';

// The app's marketplace listing (AP-B2.1, docs/api/apps/listings.md) as a
// JSON file next to the code: `pull` writes the draft the API holds, `push`
// replaces the draft with the file. The draft never reaches the marketplace
// by itself: `tassyir submit` sends it to review. Images are uploaded in the
// developer console; the file names them by id.

/** The file `pull` writes and `push` reads by default. */
export const LISTING_FILE = 'tassyir.listing.json';

/** The draft's fields, as `PUT …/listing` takes them. */
const LISTING_FIELDS: readonly (keyof ListingInput)[] = [
  'name',
  'tagline',
  'description',
  'features',
  'category',
  'searchTerms',
  'iconMediaId',
  'screenshots',
  'supportUrl',
  'privacyPolicyUrl',
  'externalService',
  'languages',
];

const CONSOLE = 'https://app.tassyir.io/en/developers';

function issueLines(issues: readonly ListingIssue[]): string[] {
  return issues.flatMap((issue) => [
    `  - ${issue.code} at ${issue.path}: ${issue.message}`,
    `    Fix: ${issue.fix}`,
  ]);
}

/** What to say about the issues left: the next command, or what is missing. */
function readiness(issues: readonly ListingIssue[]): string {
  return issues.length === 0
    ? '  Complete: `tassyir submit --distribution public` (or unlisted) sends it to review.'
    : `  ${String(issues.length)} thing${issues.length === 1 ? '' : 's'} to add before it can be submitted:`;
}

/** The images of the listing, for people: id, kind, state. */
function mediaLines(listing: DeveloperListing): string[] {
  if (listing.media.length === 0) {
    return [
      `  No images yet: upload the icon and screenshots in the developer console (${CONSOLE}), then name their ids in the file.`,
    ];
  }
  return [
    '  Images (name them by id):',
    ...listing.media.map(
      (media) =>
        `    ${media.id}  ${media.kind}  ${String(media.width)}x${String(media.height)}  ${media.status}`,
    ),
  ];
}

function viewData(listing: DeveloperListing): Record<string, unknown> {
  return {
    distribution: listing.distribution,
    listedAt: listing.listedAt,
    delistedAt: listing.delistedAt,
    draftUpdatedAt: listing.draftUpdatedAt,
    issues: listing.issues,
    live: listing.live !== null,
    media: listing.media.map((media) => ({
      id: media.id,
      kind: media.kind,
      status: media.status,
      width: media.width,
      height: media.height,
      url: media.url,
    })),
  };
}

const APP_OPTION = {
  type: 'string',
  value: 'handle|id',
  description: 'Default: the handle in ./tassyir.app.toml.',
} as const;

export const listingPullCommand: Command = {
  name: 'listing pull',
  summary: "Write the app's draft marketplace listing to a JSON file",
  usage: 'tassyir listing pull [options]',
  description: [
    `Reads the draft listing (name, tagline, description, features, category, search terms,`,
    `images, links, languages) and writes it to ./${LISTING_FILE}, in the shape`,
    '`tassyir listing push` sends back. Prints what the draft still needs before a',
    "submission (each with a fix) and the app's images with their ids. Refuses to overwrite",
    'the file unless --force.',
  ].join('\n'),
  options: {
    app: APP_OPTION,
    file: {
      type: 'string',
      value: 'path',
      description: `Default ./${LISTING_FILE}.`,
    },
    force: { type: 'boolean', description: 'Overwrite the file.' },
  },
  async run(context, { values }) {
    const path = resolve(
      context.io.cwd,
      stringValue(values['file']) ?? LISTING_FILE,
    );
    const display = relative(context.io.cwd, path) || path;
    const { api } = await context.api();
    const app = await resolveApp(context, api, stringValue(values['app']));
    const listing = (await api.getListing(app.id)).data;
    const text = `${JSON.stringify(listing.draft, null, 2)}\n`;
    try {
      await writeFile(path, text, {
        flag: values['force'] === true ? 'w' : 'wx',
      });
    } catch (error) {
      const reason = (error as NodeJS.ErrnoException).code;
      throw new CliError({
        code:
          reason === 'EEXIST'
            ? 'LISTING_FILE_EXISTS'
            : 'LISTING_FILE_UNWRITABLE',
        message:
          reason === 'EEXIST'
            ? `${display} exists already`
            : `Could not write ${display} (${reason ?? 'error'})`,
        fix:
          reason === 'EEXIST'
            ? `Push it first if it holds your edits (\`tassyir listing push\`), or pass --force to replace it with the API's draft.`
            : `Check that you can write ${display}, or pass --file <path>.`,
        exitCode: EXIT_CODES.FAILED,
      });
    }
    return {
      data: {
        app: { id: app.id, handle: app.handle },
        file: display,
        ...viewData(listing),
      },
      text: lines(
        `✓ Wrote ${display}: the draft listing of ${app.handle}${listing.draftUpdatedAt ? `, saved ${listing.draftUpdatedAt}` : ' (never saved: its names only)'}.`,
        readiness(listing.issues),
        ...issueLines(listing.issues),
        ...mediaLines(listing),
        `  Edit it, then \`tassyir listing push\`.`,
      ),
    };
  },
};

/** The file as a listing body; every problem the CLI can see before sending. */
function parseListingFile(text: string, display: string): ListingInput {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new CliError({
      code: 'LISTING_FILE_INVALID',
      message: `${display} is not valid JSON: ${(error as Error).message}`,
      fix: `Fix the JSON syntax, or write a fresh copy with \`tassyir listing pull --force\`.`,
      exitCode: EXIT_CODES.FAILED,
    });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CliError({
      code: 'LISTING_FILE_INVALID',
      message: `${display} is not a JSON object`,
      fix: "The file is one object with the draft's fields: `tassyir listing pull` writes one.",
      exitCode: EXIT_CODES.FAILED,
    });
  }
  const unknown: CliProblem[] = Object.keys(value)
    .filter((key) => !(LISTING_FIELDS as readonly string[]).includes(key))
    .map((key) => ({
      code: 'LISTING_FIELD_UNKNOWN',
      path: key,
      message: `\`${key}\` is not a field of the listing.`,
      fix: `Remove \`${key}\`; the fields are ${LISTING_FIELDS.join(', ')}.`,
    }));
  if (unknown.length > 0) {
    throw new CliError({
      code: 'LISTING_FILE_INVALID',
      message: `${display} has ${String(unknown.length)} field${unknown.length === 1 ? '' : 's'} the listing does not take; nothing was sent`,
      fix: unknown[0]?.fix ?? 'Remove the unknown fields.',
      exitCode: EXIT_CODES.FAILED,
      errors: unknown,
    });
  }
  return value;
}

export const listingPushCommand: Command = {
  name: 'listing push',
  summary: "Replace the app's draft marketplace listing with a JSON file",
  usage: 'tassyir listing push [options]',
  description: [
    `Sends ./${LISTING_FILE} as the whole draft (a field left out or null is cleared).`,
    'Refused with every problem at once (LISTING_INVALID) only for what is never right:',
    'HTML or links in the text, a length or count over its maximum, an unknown category,',
    "an image that is not the app's. What is still missing (the second language, the",
    'screenshots, the privacy policy) is saved and listed, each with a fix. The live listing',
    'changes only when a review approves it (`tassyir submit`).',
  ].join('\n'),
  options: {
    app: APP_OPTION,
    file: {
      type: 'string',
      value: 'path',
      description: `Default ./${LISTING_FILE}.`,
    },
  },
  async run(context, { values }) {
    const path = resolve(
      context.io.cwd,
      stringValue(values['file']) ?? LISTING_FILE,
    );
    const display = relative(context.io.cwd, path) || path;
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      const reason = (error as NodeJS.ErrnoException).code;
      throw new CliError({
        code:
          reason === 'ENOENT'
            ? 'LISTING_FILE_NOT_FOUND'
            : 'LISTING_FILE_UNREADABLE',
        message:
          reason === 'ENOENT'
            ? `${display} does not exist`
            : `Could not read ${display} (${reason ?? 'error'})`,
        fix:
          reason === 'ENOENT'
            ? 'Write it with `tassyir listing pull` first, or pass --file <path>.'
            : `Check that you can read ${display}.`,
        exitCode: EXIT_CODES.FAILED,
      });
    }
    const body = parseListingFile(text, display);
    const { api } = await context.api();
    const app = await resolveApp(context, api, stringValue(values['app']));
    const listing = (await api.putListing(app.id, body)).data;
    return {
      data: {
        app: { id: app.id, handle: app.handle },
        file: display,
        ...viewData(listing),
      },
      text: lines(
        `✓ Saved ${display} as the draft listing of ${app.handle} (the marketplace shows the live one until a review approves this).`,
        readiness(listing.issues),
        ...issueLines(listing.issues),
      ),
    };
  },
};
