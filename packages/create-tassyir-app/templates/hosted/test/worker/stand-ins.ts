import { DurableObject } from 'cloudflare:workers';

// The specs' main module (vitest.config.ts). On Tassyir Hosting,
// ctx.props.STORAGE is an RPC stub of the installation's SQLite Durable
// Object; here StandInStorage is one too, with the same three methods and
// rules (each call one transaction), so the specs run the app's real SQL
// in workerd.

type SqlValue = string | number | null | ArrayBuffer;

interface Statement {
  query: string;
  bindings?: unknown[];
}

export class StandInStorage extends DurableObject {
  sql(query: string, ...bindings: unknown[]) {
    return this.ctx.storage.transactionSync(() => this.#exec(query, bindings));
  }

  batch(statements: Statement[]) {
    return this.ctx.storage.transactionSync(() =>
      statements.map(({ query, bindings }) =>
        this.#exec(query, bindings ?? []),
      ),
    );
  }

  usage() {
    return { bytes: this.ctx.storage.sql.databaseSize, limitBytes: 52_428_800 };
  }

  #exec(query: string, bindings: unknown[]) {
    const cursor = this.ctx.storage.sql.exec<Record<string, SqlValue>>(
      query,
      ...bindings,
    );
    const rows = cursor.toArray();
    return { rows, rowsRead: cursor.rowsRead, rowsWritten: cursor.rowsWritten };
  }
}

export default {
  fetch(): Response {
    return new Response('The specs’ stand-ins: nothing to serve.', {
      status: 404,
    });
  },
};
