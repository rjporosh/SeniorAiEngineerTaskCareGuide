import { computeBackoff, queueMessageSchema, type QueueMessage, type QueuePort, type RetryPolicy } from './queue.js';
import type { OutboxRecord } from '../domain/types.js';
import type { OutboxRepository } from './ports.js';

export interface RelayLogger { warn(msg: string): void; error(msg: string): void }
export interface RelayOptions { batchSize?: number; intervalMs?: number; maxAttempts?: number; backoff?: Pick<RetryPolicy, 'baseDelayMs' | 'maxDelayMs'> }

/** Maps a persisted outbox row to the broker envelope. The outbox id doubles as the message id (dedup key). */
export function toQueueMessage(row: OutboxRecord): QueueMessage {
  const p = row.payload as { documentId?: string; attemptId?: string; correlationId?: string; idempotencyKey?: string };
  return queueMessageSchema.parse({
    messageId: row.id, jobType: row.topic, schemaVersion: 1, documentId: p.documentId, attemptId: p.attemptId,
    correlationId: p.correlationId ?? row.id, idempotencyKey: p.idempotencyKey ?? `${p.documentId}:${p.attemptId}`,
    createdAt: row.createdAt.toISOString(), payload: {},
  });
}

/**
 * Transactional-outbox relay: rows written atomically with business state are published to the broker
 * at-least-once; consumers are idempotent. Failed publishes back off and eventually dead-letter.
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private readonly batchSize: number; private readonly intervalMs: number; private readonly maxAttempts: number;
  private readonly backoff: Pick<RetryPolicy, 'baseDelayMs' | 'maxDelayMs'>;

  constructor(private readonly outbox: OutboxRepository, private readonly queue: QueuePort, private readonly log: RelayLogger, o: RelayOptions = {}) {
    this.batchSize = o.batchSize ?? 50; this.intervalMs = o.intervalMs ?? 1000; this.maxAttempts = o.maxAttempts ?? 10;
    this.backoff = o.backoff ?? { baseDelayMs: 1000, maxDelayMs: 60_000 };
  }

  start(): void {
    this.stopped = false;
    const loop = () => {
      if (this.stopped) return;
      this.running = this.tick().catch((e: unknown) => this.log.error(`outbox relay tick failed: ${(e as Error).message}`))
        .finally(() => { if (!this.stopped) this.timer = setTimeout(loop, this.intervalMs); });
    };
    loop();
  }

  /** Publishes one batch; returns how many rows were sent. */
  async tick(now = new Date()): Promise<number> {
    const rows = await this.outbox.claimPending(this.batchSize, now);
    let sent = 0;
    for (const row of rows) {
      try {
        await this.queue.publish(toQueueMessage(row));
        await this.outbox.markSent(row.id);
        sent++;
      } catch (e) {
        const dead = row.attempts + 1 >= this.maxAttempts;
        const retryAt = new Date(now.getTime() + computeBackoff(row.attempts + 1, this.backoff));
        this.log.warn(`outbox ${row.id} publish failed (attempt ${row.attempts + 1}${dead ? ', dead-lettered' : ''}): ${(e as Error).message}`);
        await this.outbox.markFailed(row.id, (e as Error).message, retryAt, dead);
      }
    }
    return sent;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}
