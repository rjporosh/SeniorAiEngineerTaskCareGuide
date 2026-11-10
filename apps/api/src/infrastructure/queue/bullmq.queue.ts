import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import {
  PermanentJobError, computeBackoff, queueMessageSchema, type MessageHandler, type QueueMessage, type QueuePort,
  type QueueStats, type RetryPolicy,
} from '../../application/queue.js';

export interface BullOptions { url: string; policy: RetryPolicy; namespace?: string }

/**
 * Redis-backed adapter. BullMQ semantics differ from AMQP: jobs are retried by the worker using the
 * custom jittered backoff below and exhausted/unrecoverable jobs remain in the `failed` set, which is
 * this adapter's dead-letter store. Only the application contract (QueuePort) is normalised.
 */
export class BullMqQueue implements QueuePort {
  readonly provider = 'bullmq' as const;
  private readonly name: string;
  private readonly connection: Redis;
  private readonly queue: Queue;
  private worker: Worker | null = null;

  constructor(private readonly opts: BullOptions) {
    this.name = `${opts.namespace ?? 'docint'}-jobs`;
    this.connection = new Redis(opts.url, { maxRetriesPerRequest: null, enableReadyCheck: true });
    this.queue = new Queue(this.name, { connection: this.connection });
  }

  async publish(message: QueueMessage): Promise<void> {
    await this.queue.add(message.jobType, message, {
      jobId: message.messageId, // deduplicates re-published outbox rows
      attempts: this.opts.policy.maxAttempts, backoff: { type: 'jittered' },
      removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: false,
    });
  }

  async startConsumer(handler: MessageHandler, options: { concurrency: number }): Promise<void> {
    const { maxAttempts } = this.opts.policy;
    this.worker = new Worker(this.name, async (job) => {
      const parsed = queueMessageSchema.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError('invalid message envelope');
      const attempt = job.attemptsMade + 1;
      try {
        await handler(parsed.data, { attempt, maxAttempts, isFinalAttempt: attempt >= maxAttempts });
      } catch (e) {
        if (e instanceof PermanentJobError) throw new UnrecoverableError(e.message);
        throw e;
      }
    }, {
      connection: this.connection.duplicate(), concurrency: options.concurrency,
      settings: { backoffStrategy: (attemptsMade: number) => computeBackoff(attemptsMade, this.opts.policy) },
    });
    await this.worker.waitUntilReady();
  }

  async stats(): Promise<QueueStats> {
    const c = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    return { ready: (c['waiting'] ?? 0) + (c['active'] ?? 0) + (c['delayed'] ?? 0), deadLettered: c['failed'] ?? 0 };
  }

  async ping(): Promise<void> {
    if ((await this.connection.ping()) !== 'PONG') throw new Error('Redis ping failed');
  }

  async close(): Promise<void> {
    await this.worker?.close(); // waits for in-flight jobs
    await this.queue.close();
    this.connection.disconnect();
  }
}
