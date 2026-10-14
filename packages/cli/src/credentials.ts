import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError, EXIT_CODES } from './errors.js';
import type { CliIo } from './io.js';

// Where the developer token lives between commands (README, "Where the token
// is stored"):
//   1. TASSYIR_TOKEN, when set (CI): never stored, never revoked by logout.
//   2. The OS keychain, when one answers: the macOS login keychain through
//      /usr/bin/security, or the Secret Service (GNOME Keyring, KWallet)
//      through secret-tool. The token travels on the program's stdin, never
//      in its arguments, so no process listing shows it.
//   3. Otherwise a file only the user can read (0600, in a 0700 folder):
//      credentials.json in the config folder. Windows always uses it for now.
// credentials.json also holds what is not secret (the email, the token id)
// for every API origin, so whoami works offline and staging and production
// sessions sit side by side. Nothing here prints.

/** The keychain entry's service; its account is the API origin. */
export const KEYCHAIN_SERVICE = 'tassyir-cli';

/** A developer token's shape (plan §3.4: `tsy_dt_<43 base62>`). */
export const DEVELOPER_TOKEN_PATTERN = /^tsy_dt_[0-9A-Za-z]{20,}$/;

const FILE_NAME = 'credentials.json';
const FORMAT_VERSION = 1;

export type StorageKind = 'keychain' | 'file' | 'env';

/** What `credentials.json` keeps per API origin. `token` only for `file`. */
export interface StoredSession {
  storage: 'keychain' | 'file';
  tokenId: string;
  userId: string;
  email: string;
  savedAt: string;
  token?: string;
}

interface CredentialsFile {
  version: number;
  sessions: Record<string, StoredSession>;
}

/** The token a command runs with, and where it came from. */
export interface ResolvedToken {
  token: string;
  storage: StorageKind;
  session: StoredSession | undefined;
}

export interface SaveResult {
  storage: 'keychain' | 'file';
  /** "the macOS keychain", "the Secret Service (secret-tool)", or the file's path. */
  where: string;
  /** In the file although no one asked for it: no keychain took the token. */
  fallback: boolean;
}

/** The folder of credentials.json: TASSYIR_CONFIG_DIR, XDG, or the platform's. */
export function configDirectory(io: CliIo): string {
  const explicit = io.env['TASSYIR_CONFIG_DIR']?.trim();
  if (explicit) return explicit;
  if (io.platform === 'win32') {
    const appData = io.env['APPDATA']?.trim();
    return join(appData || join(io.homedir, 'AppData', 'Roaming'), 'tassyir');
  }
  const xdg = io.env['XDG_CONFIG_HOME']?.trim();
  return join(xdg || join(io.homedir, '.config'), 'tassyir');
}

// ── Keychain backends ───────────────────────────────────────────────────────

interface Keychain {
  /** For messages: "the macOS keychain". */
  label: string;
  get(account: string): Promise<string | undefined>;
  /** True when the keychain now holds `token` for `account`. */
  set(account: string, token: string): Promise<boolean>;
  remove(account: string): Promise<void>;
}

/**
 * A value for `security -i`'s command line: single-quoted, with `\\` and `'`
 * backslash-escaped (its own word splitting, not a POSIX shell's). The API
 * origin and the token never hold either (resolveApiOrigin, the token's
 * shape); this keeps it right if that ever changes.
 */
function quoted(value: string): string {
  return `'${value.replace(/[\\']/g, '\\$&')}'`;
}

function macKeychain(io: CliIo): Keychain {
  const security = '/usr/bin/security';
  const get = async (account: string): Promise<string | undefined> => {
    const result = await io.exec(security, [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      account,
      '-w',
    ]);
    if (result.code !== 0) return undefined;
    const token = result.stdout.trim();
    return token === '' ? undefined : token;
  };
  return {
    label: 'the macOS keychain',
    get,
    async set(account, token) {
      // `security -i` reads its commands from stdin: the token never
      // appears in a process listing (as zalando/go-keyring does for gh).
      const result = await io.exec(security, ['-i'], {
        input: `add-generic-password -U -s ${quoted(KEYCHAIN_SERVICE)} -a ${quoted(account)} -l ${quoted('Tassyir CLI')} -w ${quoted(token)}\n`,
      });
      if (result.code !== 0) return false;
      // Interactive mode may exit 0 after a failed command: read it back.
      return (await get(account)) === token;
    },
    async remove(account) {
      await io.exec(security, [
        'delete-generic-password',
        '-s',
        KEYCHAIN_SERVICE,
        '-a',
        account,
      ]);
    },
  };
}

function secretService(io: CliIo): Keychain {
  const attributes = (account: string) => [
    'service',
    KEYCHAIN_SERVICE,
    'account',
    account,
  ];
  const get = async (account: string): Promise<string | undefined> => {
    const result = await io.exec('secret-tool', [
      'lookup',
      ...attributes(account),
    ]);
    if (result.code !== 0) return undefined;
    const token = result.stdout.trim();
    return token === '' ? undefined : token;
  };
  return {
    label: 'the Secret Service (secret-tool)',
    get,
    async set(account, token) {
      // secret-tool reads the secret from stdin.
      const result = await io.exec(
        'secret-tool',
        [
          'store',
          '--label',
          `Tassyir CLI (${account})`,
          ...attributes(account),
        ],
        { input: token },
      );
      if (result.code !== 0) return false;
      return (await get(account)) === token;
    },
    async remove(account) {
      await io.exec('secret-tool', ['clear', ...attributes(account)]);
    },
  };
}

/** The platform's keychain, or undefined when the CLI has none for it. */
function keychainFor(io: CliIo): Keychain | undefined {
  if (io.platform === 'darwin') return macKeychain(io);
  if (io.platform === 'linux' || io.platform === 'freebsd') {
    return secretService(io);
  }
  // Windows: Credential Manager has no command that reads a secret back
  // without PowerShell and WinRT; the 0600-style file under %APPDATA% (a
  // folder only the user can read) until that is built and tested there.
  return undefined;
}

/** TASSYIR_CREDENTIAL_STORE: `keychain`, `file`, or unset (keychain, else file). */
function storePreference(io: CliIo): 'auto' | 'keychain' | 'file' {
  const value = io.env['TASSYIR_CREDENTIAL_STORE']?.trim().toLowerCase();
  if (!value || value === 'auto') return 'auto';
  if (value === 'keychain' || value === 'file') return value;
  throw new CliError({
    code: 'INVALID_ARGUMENT',
    message: `TASSYIR_CREDENTIAL_STORE is "${value}"`,
    fix: 'Set TASSYIR_CREDENTIAL_STORE to keychain or file, or unset it (the keychain when one answers, else the file).',
    exitCode: EXIT_CODES.USAGE,
  });
}

// ── credentials.json ────────────────────────────────────────────────────────

export class CredentialStore {
  readonly #io: CliIo;
  readonly directory: string;
  readonly path: string;

  constructor(io: CliIo) {
    this.#io = io;
    this.directory = configDirectory(io);
    this.path = join(this.directory, FILE_NAME);
  }

  /**
   * The token for `apiOrigin`: TASSYIR_TOKEN first, then the stored one
   * (only the stored one with `stored: true`).
   */
  async resolve(
    apiOrigin: string,
    options: { stored?: boolean } = {},
  ): Promise<ResolvedToken | undefined> {
    const fromEnv = options.stored
      ? undefined
      : this.#io.env['TASSYIR_TOKEN']?.trim();
    if (fromEnv) {
      if (!DEVELOPER_TOKEN_PATTERN.test(fromEnv)) {
        throw new CliError({
          code: 'TOKEN_ENV_INVALID',
          message:
            'TASSYIR_TOKEN is set but is not a developer token (tsy_dt_…)',
          fix: 'Set TASSYIR_TOKEN to the tsy_dt_… token of a `tassyir login`, or unset it to use the stored sign-in.',
          exitCode: EXIT_CODES.AUTH,
        });
      }
      return {
        token: fromEnv,
        storage: 'env',
        session: (await this.#read()).sessions[apiOrigin],
      };
    }
    const session = (await this.#read()).sessions[apiOrigin];
    if (!session) return undefined;
    let token: string | undefined;
    if (session.storage === 'file') {
      token = session.token;
    } else {
      token = await keychainFor(this.#io)?.get(apiOrigin);
    }
    if (!token || !DEVELOPER_TOKEN_PATTERN.test(token)) {
      throw new CliError({
        code: 'CREDENTIALS_UNAVAILABLE',
        message:
          session.storage === 'keychain'
            ? 'The sign-in is recorded, but the keychain did not give its token back (locked, or the entry was deleted)'
            : `${this.path} holds no usable token`,
        fix: 'Run `tassyir login` again (unlock the keychain first if it is locked).',
        exitCode: EXIT_CODES.AUTH,
      });
    }
    return { token, storage: session.storage, session };
  }

  /** Refuses a TASSYIR_CREDENTIAL_STORE it cannot honour, before a sign-in starts. */
  checkPreference(): void {
    storePreference(this.#io);
  }

  /** The non-secret record of `apiOrigin`'s sign-in, if any. */
  async session(apiOrigin: string): Promise<StoredSession | undefined> {
    return (await this.#read()).sessions[apiOrigin];
  }

  /** Stores a new token for `apiOrigin`: the keychain when it answers, else the file. */
  async save(
    apiOrigin: string,
    token: string,
    identity: { tokenId: string; userId: string; email: string },
  ): Promise<SaveResult> {
    const preference = storePreference(this.#io);
    const keychain = preference === 'file' ? undefined : keychainFor(this.#io);
    let stored: SaveResult | undefined;
    if (keychain && (await keychain.set(apiOrigin, token))) {
      stored = { storage: 'keychain', where: keychain.label, fallback: false };
    } else if (preference === 'keychain') {
      throw new CliError({
        code: 'KEYCHAIN_UNAVAILABLE',
        message: keychain
          ? `${keychain.label} did not take the token`
          : `The CLI has no keychain for ${this.#io.platform}`,
        fix: 'Unlock or start your keychain (on Linux: a Secret Service such as GNOME Keyring, and secret-tool), or set TASSYIR_CREDENTIAL_STORE=file.',
        exitCode: EXIT_CODES.FAILED,
      });
    } else if (keychain) {
      // An earlier sign-in's entry would otherwise outlive this one.
      await keychain.remove(apiOrigin);
    }
    const file = await this.#read();
    const session: StoredSession = {
      storage: stored ? 'keychain' : 'file',
      tokenId: identity.tokenId,
      userId: identity.userId,
      email: identity.email,
      savedAt: new Date(this.#io.now()).toISOString(),
      ...(stored ? {} : { token }),
    };
    file.sessions[apiOrigin] = session;
    await this.#write(file);
    return (
      stored ?? {
        storage: 'file',
        where: this.path,
        fallback: preference === 'auto',
      }
    );
  }

  /** Forgets `apiOrigin`'s token, wherever it is. True when there was one. */
  async remove(apiOrigin: string): Promise<boolean> {
    const file = await this.#read();
    const session = file.sessions[apiOrigin];
    if (session?.storage !== 'file') {
      // Also clears an entry left behind by an earlier keychain sign-in.
      await keychainFor(this.#io)?.remove(apiOrigin);
    }
    if (!session) return false;
    file.sessions = Object.fromEntries(
      Object.entries(file.sessions).filter(([origin]) => origin !== apiOrigin),
    );
    await this.#write(file);
    return true;
  }

  async #read(): Promise<CredentialsFile> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: FORMAT_VERSION, sessions: {} };
      }
      throw this.#fileError('read', error);
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as CredentialsFile).sessions === 'object'
      ) {
        return {
          version: FORMAT_VERSION,
          sessions: { ...(parsed as CredentialsFile).sessions },
        };
      }
    } catch {
      // Unreadable: answered below.
    }
    throw new CliError({
      code: 'CREDENTIALS_UNREADABLE',
      message: `${this.path} is not a credentials file the CLI can read`,
      fix: `Delete ${this.path}, then run \`tassyir login\` again.`,
      exitCode: EXIT_CODES.AUTH,
    });
  }

  /** Atomic: a 0600 temp file in the same 0700 folder, fsync, rename. */
  async #write(file: CredentialsFile): Promise<void> {
    const temporary = join(
      this.directory,
      `.${FILE_NAME}.${randomBytes(6).toString('hex')}.tmp`,
    );
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path);
      if (this.#io.platform !== 'win32') await chmod(this.path, 0o600);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw this.#fileError('write', error);
    }
  }

  #fileError(action: 'read' | 'write', error: unknown): CliError {
    const reason = (error as NodeJS.ErrnoException).code ?? 'error';
    return new CliError({
      code: 'CREDENTIALS_UNWRITABLE',
      message: `Could not ${action} ${this.path} (${reason})`,
      fix: `Check that you own ${this.directory}, or set TASSYIR_CONFIG_DIR to a folder you can write.`,
      exitCode: EXIT_CODES.FAILED,
    });
  }
}
