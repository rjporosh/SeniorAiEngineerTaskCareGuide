import { describe, expect, it } from 'vitest';
import { computeBackoff, queueMessageSchema } from './queue.js';

describe('computeBackoff', () => {
  const p = { baseDelayMs: 1000, maxDelayMs: 8000 };
  it('grows exponentially and is capped', () => {
    expect(computeBackoff(1, p, () => 1)).toBe(1000);
    expect(computeBackoff(3, p, () => 1)).toBe(4000);
    expect(computeBackoff(10, p, () => 1)).toBe(8000);
  });
  it('applies full jitter and never returns 0', () => {
    expect(computeBackoff(2, p, () => 0)).toBe(1);
    expect(computeBackoff(2, p, () => 0.5)).toBe(1000);
  });
});

describe('queueMessageSchema', () => {
  const valid = {
    messageId: '3b241101-e2bb-4255-8caf-4136c566a962', jobType: 'document.process', schemaVersion: 1,
    documentId: '3b241101-e2bb-4255-8caf-4136c566a963', attemptId: '3b241101-e2bb-4255-8caf-4136c566a964',
    correlationId: 'c1', idempotencyKey: 'k1', createdAt: new Date().toISOString(),
  };
  it('accepts a valid envelope and defaults payload', () => {
    expect(queueMessageSchema.parse(valid).payload).toEqual({});
  });
  it('rejects unknown job types and schema versions', () => {
    expect(queueMessageSchema.safeParse({ ...valid, jobType: 'x' }).success).toBe(false);
    expect(queueMessageSchema.safeParse({ ...valid, schemaVersion: 2 }).success).toBe(false);
  });
});
