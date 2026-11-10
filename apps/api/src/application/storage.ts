import type { Readable } from 'node:stream';

export interface ObjectStoragePort {
  readonly provider: 'minio' | 'local';
  /** Streams `body` into storage under `key`; rejects (leaving no partial object) if the stream errors. */
  put(key: string, body: Readable, opts: { contentType: string }): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  ping(): Promise<void>;
}

const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isValidStorageKey = (key: string): boolean => KEY_PATTERN.test(key);
/** Generated, opaque storage key. The client-supplied filename is never part of it. */
export const newStorageKey = (id: string, now = new Date()): string =>
  `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
