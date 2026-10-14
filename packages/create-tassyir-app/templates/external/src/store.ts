import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { TokenSet, TokenStore } from '@tassyir/app';

// A small persistent store in one JSON file (DATA_DIR/store.json), enough to
// run this app as ONE process. It holds:
//   - each installation's offline token set, behind @tassyir/app's
//     TokenStore interface, encrypted with TOKEN_STORE_KEY (AES-256-GCM);
//   - the installations this app knows (from app/installed, or from a
//     verified page visit);
//   - the webhook-ids already handled (deliveries come at least once).
// Every write replaces the file atomically (temp file, fsync, rename), so a
// write that resolved survives a crash. @tassyir/app relies on that: it
// stores a rotated refresh token before using it, and a lost one, presented
// again later, revokes the installation's tokens.
//
// Several processes, or a host without a persistent disk: move this to your
// database, keep the TokenStore contract, and give createTassyirApp a
// RefreshLock.

/** Replays reuse a webhook-id, and Tassyir keeps an event 7 days. */
const HANDLED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface InstallationRecord {
  businessId: string;
  installedAt: string;
  uninstalledAt: string | null;
}

interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

interface StoreDocument {
  version: 1;
  installations: Record<string, InstallationRecord>;
  tokens: Record<string, Sealed>;
  /** webhook-id → when it was handled (ms since the epoch). */
  handled: Record<string, number>;
}

/** What the server needs from its store (src/app.ts, src/webhooks.ts). */
export interface AppStore {
  /** Pass to createTassyirApp({ tokenStore }). */
  readonly tokens: TokenStore;
  installation(installationId: string): InstallationRecord | undefined;
  recordInstallation(installationId: string, businessId: string): Promise<void>;
  markUninstalled(installationId: string): Promise<void>;
  forgetInstallation(installationId: string): Promise<void>;
  hasHandled(webhookId: string): boolean;
  markHandled(webhookId: string): Promise<void>;
}

export class FileStore implements AppStore {
  readonly path: string;
  readonly tokens: TokenStore;
  readonly #key: Buffer;
  readonly #doc: StoreDocument;
  #writes: Promise<void> = Promise.resolve();
  #warnedUnreadable = false;

  private constructor(path: string, key: Buffer, doc: StoreDocument) {
    this.path = path;
    this.#key = key;
    this.#doc = doc;
    this.tokens = {
      get: (installationId) => this.#readTokens(installationId),
      set: (installationId, tokens) => {
        this.#doc.tokens[installationId] = this.#seal(installationId, tokens);
        return this.#save();
      },
      delete: (installationId) => {
        if (!(installationId in this.#doc.tokens)) return;
        delete this.#doc.tokens[installationId];
        return this.#save();
      },
    };
  }

  /** Opens the store file, or starts an empty one. */
  static async open(path: string, key: Buffer): Promise<FileStore> {
    if (key.length !== 32) {
      throw new Error(
        'The token store key must be 32 bytes (TOKEN_STORE_KEY).',
      );
    }
    let text: string | undefined;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return new FileStore(
      path,
      key,
      text === undefined ? empty() : parse(path, text),
    );
  }

  installation(installationId: string): InstallationRecord | undefined {
    return this.#doc.installations[installationId];
  }

  /** Remembers an installation (again, after a reinstall). */
  async recordInstallation(
    installationId: string,
    businessId: string,
  ): Promise<void> {
    const known = this.#doc.installations[installationId];
    if (known && known.uninstalledAt === null) return;
    this.#doc.installations[installationId] = {
      businessId,
      installedAt: new Date().toISOString(),
      uninstalledAt: null,
    };
    await this.#save();
  }

  async markUninstalled(installationId: string): Promise<void> {
    const known = this.#doc.installations[installationId];
    if (!known || known.uninstalledAt !== null) return;
    known.uninstalledAt = new Date().toISOString();
    await this.#save();
  }

  /** business/redact: forget everything about the installation. */
  async forgetInstallation(installationId: string): Promise<void> {
    delete this.#doc.installations[installationId];
    delete this.#doc.tokens[installationId];
    await this.#save();
  }

  hasHandled(webhookId: string): boolean {
    return webhookId in this.#doc.handled;
  }

  async markHandled(webhookId: string, now = Date.now()): Promise<void> {
    for (const [id, at] of Object.entries(this.#doc.handled)) {
      if (now - at > HANDLED_RETENTION_MS) delete this.#doc.handled[id];
    }
    this.#doc.handled[webhookId] = now;
    await this.#save();
  }

  #readTokens(installationId: string): TokenSet | undefined {
    const sealed = this.#doc.tokens[installationId];
    if (!sealed) return undefined;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.#key,
        Buffer.from(sealed.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(installationId, 'utf8'));
      decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
      const text = Buffer.concat([
        decipher.update(Buffer.from(sealed.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(text) as TokenSet;
    } catch {
      // Another TOKEN_STORE_KEY wrote it. Reading it as missing makes the
      // next page view exchange a fresh ID token.
      if (!this.#warnedUnreadable) {
        this.#warnedUnreadable = true;
        console.warn(
          `Stored tokens in ${this.path} cannot be decrypted (was TOKEN_STORE_KEY changed?). They are ignored; opening the app's page gets new ones.`,
        );
      }
      return undefined;
    }
  }

  #seal(installationId: string, tokens: TokenSet): Sealed {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    // Bound to its installation: an entry copied under another id fails.
    cipher.setAAD(Buffer.from(installationId, 'utf8'));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(tokens), 'utf8'),
      cipher.final(),
    ]);
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
  }

  /** Writes a snapshot of the document; writes run one at a time, in order. */
  #save(): Promise<void> {
    const text = `${JSON.stringify(this.#doc, null, 2)}\n`;
    const write = this.#writes.then(() => writeAtomically(this.path, text));
    this.#writes = write.catch(() => undefined);
    return write;
  }
}

function empty(): StoreDocument {
  return { version: 1, installations: {}, tokens: {}, handled: {} };
}

function parse(path: string, text: string): StoreDocument {
  const doc = JSON.parse(text) as Partial<StoreDocument> | null;
  if (
    doc?.version !== 1 ||
    typeof doc.installations !== 'object' ||
    typeof doc.tokens !== 'object' ||
    typeof doc.handled !== 'object'
  ) {
    throw new Error(
      `${path} is not this app's store file. Move it away (or set DATA_DIR) and start again.`,
    );
  }
  return doc as StoreDocument;
}

async function writeAtomically(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${String(process.pid)}.tmp`;
  const file = await open(temp, 'w', 0o600);
  try {
    await file.writeFile(text, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
}
