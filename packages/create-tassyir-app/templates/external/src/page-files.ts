import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Reads the built page's files from a folder (Node). */
export function pageFilesIn(
  dir: string,
): (name: string) => Promise<Uint8Array<ArrayBuffer> | undefined> {
  return async (name) => {
    try {
      return new Uint8Array(await readFile(join(dir, name)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };
}
