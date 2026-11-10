import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConcurrencyError } from '../application/ports.js';
import { AppError, notFound } from './errors.js';
import { mapException } from './global-exception.filter.js';
import { ZodPipe } from './zod.pipe.js';

describe('ZodPipe', () => {
  const pipe = new ZodPipe(z.object({ email: z.email(), age: z.number().int().min(18), name: z.string().min(1) }));
  it('returns ALL validation errors in one response, not just the first', () => {
    try { pipe.transform({ email: 'nope', age: 3 }); expect.unreachable(); }
    catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.status).toBe(422);
      expect(err.errors.map((x) => x.field).sort()).toEqual(['age', 'email', 'name']);
      expect(err.errors.every((x) => x.code && x.message)).toBe(true);
    }
  });
  it('passes valid input through typed', () => {
    expect(pipe.transform({ email: 'a@b.io', age: 20, name: 'x' }).age).toBe(20);
  });
});

describe('mapException', () => {
  it('maps domain errors to stable codes', () => {
    expect(mapException(notFound('Document'))).toMatchObject({ status: 404, code: 'NOT_FOUND', expected: true });
    expect(mapException(new ConcurrencyError())).toMatchObject({ status: 409, code: 'CONCURRENT_MODIFICATION' });
    expect(mapException(new HttpException('x', 429))).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  });
  it('hides internals of unexpected errors', () => {
    const m = mapException(new Error('connect ECONNREFUSED postgresql://user:secret@db/x'));
    expect(m.status).toBe(500);
    expect(m.message).not.toMatch(/secret|postgresql/);
    expect(m.expected).toBe(false);
  });
});
