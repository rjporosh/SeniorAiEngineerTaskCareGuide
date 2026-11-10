import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { validationFailed } from './errors.js';

/** Validates with Zod and reports EVERY problem at once (never stops at the first). */
@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (r.success) return r.data;
    throw validationFailed(r.error.issues.map((i) => ({
      code: i.code, field: i.path.length > 0 ? i.path.join('.') : null, message: i.message,
    })));
  }
}
