import type { Readable } from 'node:stream';
import { Readable as NodeReadable } from 'node:stream';
import { processResponseSchema, type ProcessResponse } from './processor.types.js';

/** A failure reported by (or while calling) the processor. `retryable` decides between retry and terminal failure. */
export class ProcessorError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'ProcessorError';
  }
}

export interface DocumentProcessorPort {
  process(body: Readable, opts: { requestId: string }): Promise<ProcessResponse>;
  ping(): Promise<void>;
}

export class HttpDocumentProcessor implements DocumentProcessorPort {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly timeoutMs: number) {}

  async process(body: Readable, opts: { requestId: string }): Promise<ProcessResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/internal/v1/process`, {
        method: 'POST', body: NodeReadable.toWeb(body) as ReadableStream, duplex: 'half',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/octet-stream', 'x-request-id': opts.requestId },
        signal: AbortSignal.timeout(this.timeoutMs),
      } as RequestInit);
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new ProcessorError(timeout ? 'PROCESSOR_TIMEOUT' : 'PROCESSOR_UNAVAILABLE', timeout ? 'The document processor timed out.' : 'The document processor is unreachable.', true);
    }
    if (res.ok) {
      const parsed = processResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new ProcessorError('PROCESSOR_BAD_RESPONSE', 'The document processor returned an unexpected response.', true);
      return parsed.data;
    }
    const err = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; retryable?: boolean } } | null;
    const code = err?.error?.code ?? `PROCESSOR_HTTP_${res.status}`;
    // 401 is a deployment misconfiguration, not a property of the document; retrying will not help.
    const retryable = res.status === 401 ? false : (err?.error?.retryable ?? res.status >= 500);
    throw new ProcessorError(code, err?.error?.message ?? `The document processor returned HTTP ${res.status}.`, retryable);
  }

  async ping(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/health/ready`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`processor not ready (${res.status})`);
  }
}
