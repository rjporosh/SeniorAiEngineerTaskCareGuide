import { z } from 'zod';

export const JOB_TYPES = ['document.process'] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** Versioned message envelope shared by every broker adapter. */
export const queueMessageSchema = z.object({
  messageId: z.uuid(),
  jobType: z.enum(JOB_TYPES),
  schemaVersion: z.literal(1),
  documentId: z.uuid(),
  attemptId: z.uuid(),
  correlationId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(256),
  createdAt: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type QueueMessage = z.infer<typeof queueMessageSchema>;

export interface RetryPolicy { maxAttempts: number; baseDelayMs: number; maxDelayMs: number }

/** Thrown by handlers for deterministic failures that must not be retried (corrupt input, validation). */
export class PermanentJobError extends Error {
  constructor(message: string, public readonly code = 'PERMANENT_FAILURE') {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export interface DeliveryContext { attempt: number; maxAttempts: number; isFinalAttempt: boolean }
export type MessageHandler = (message: QueueMessage, ctx: DeliveryContext) => Promise<void>;

export interface QueueStats { ready: number; deadLettered: number }

export interface QueuePort {
  readonly provider: 'rabbitmq' | 'bullmq';
  /** Resolves only once the broker has durably accepted the message (publisher confirm / Redis write). */
  publish(message: QueueMessage): Promise<void>;
  /** Starts consuming. Handler success acknowledges; PermanentJobError dead-letters; other errors are retried. */
  startConsumer(handler: MessageHandler, options: { concurrency: number }): Promise<void>;
  stats(): Promise<QueueStats>;
  ping(): Promise<void>;
  /** Stops accepting deliveries and waits for in-flight handlers to finish. */
  close(): Promise<void>;
}

/** Exponential backoff with full jitter. `attempt` is 1-based (the attempt that just failed). */
export function computeBackoff(attempt: number, p: Pick<RetryPolicy, 'baseDelayMs' | 'maxDelayMs'>, random: () => number = Math.random): number {
  const ceiling = Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.max(1, Math.floor(random() * ceiling));
}
