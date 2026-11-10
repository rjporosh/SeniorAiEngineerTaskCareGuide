import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, access, constants } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { isValidStorageKey, type ObjectStoragePort } from '../../application/storage.js';

/** Development/test storage on the local filesystem. Keys are validated so they cannot escape the root. */
export class LocalObjectStorage implements ObjectStoragePort {
  readonly provider = 'local' as const;
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  private pathFor(key: string): string {
    if (!isValidStorageKey(key)) throw new Error('Invalid storage key');
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, body: Readable): Promise<void> {
    const target = this.pathFor(key);
    const tmp = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });
    try {
      await pipeline(body, createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
      await rename(tmp, target);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }
  async get(key: string): Promise<Readable> {
    const p = this.pathFor(key);
    await stat(p);
    return createReadStream(p);
  }
  async delete(key: string): Promise<void> { await rm(this.pathFor(key), { force: true }); }
  async ping(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.W_OK);
  }
}
