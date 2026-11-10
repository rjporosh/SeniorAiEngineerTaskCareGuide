import { createHash, type Hash } from 'node:crypto';
import { Readable, Transform, type TransformCallback } from 'node:stream';

/** Reads up to `n` bytes without consuming the rest; returns the head and a stream that replays everything. */
export async function peek(source: Readable, n: number): Promise<{ head: Buffer; stream: Readable }> {
  const chunks: Buffer[] = [];
  let size = 0;
  const it = source[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  let done = false;
  while (size < n) {
    const r = await it.next();
    if (r.done) { done = true; break; }
    chunks.push(r.value); size += r.value.length;
  }
  const buffered = Buffer.concat(chunks);
  async function* replay(): AsyncGenerator<Buffer> {
    if (buffered.length > 0) yield buffered;
    if (done) return;
    for (;;) {
      const r = await it.next();
      if (r.done) return;
      yield r.value;
    }
  }
  return { head: buffered.subarray(0, n), stream: Readable.from(replay(), { objectMode: false }) };
}

/** Counts bytes and hashes while passing data through; aborts when the byte budget is exceeded. */
export class MeterStream extends Transform {
  bytes = 0;
  private readonly hash: Hash = createHash('sha256');
  constructor(private readonly limit: (bytesSoFar: number) => Error | null) { super(); }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.bytes += chunk.length;
    const err = this.limit(this.bytes);
    if (err) { cb(err); return; }
    this.hash.update(chunk);
    cb(null, chunk);
  }
  digest(): string { return this.hash.digest('hex'); }
}
