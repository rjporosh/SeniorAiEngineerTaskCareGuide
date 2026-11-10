import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { failure } from './envelope.js';
import { AppError, type FieldError } from './errors.js';
import { ConcurrencyError, NotSupportedError } from '../application/ports.js';
import { currentCorrelationId } from './request-context.js';

interface Mapped { status: number; code: string; message: string; errors: FieldError[]; expected: boolean }

export function mapException(e: unknown): Mapped {
  if (e instanceof AppError) return { status: e.status, code: e.code, message: e.message, errors: e.errors, expected: e.status < 500 };
  if (e instanceof ConcurrencyError) return { status: 409, code: 'CONCURRENT_MODIFICATION', message: 'The record was changed by someone else. Reload and try again.', errors: [], expected: true };
  if (e instanceof NotSupportedError) return { status: 501, code: 'NOT_SUPPORTED', message: 'This capability is not available with the current configuration.', errors: [], expected: true };
  if (e instanceof HttpException) {
    const status = e.getStatus();
    const code = status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : `HTTP_${status}`;
    const message = status === 429 ? 'Too many requests. Please slow down and retry later.' : status >= 500 ? 'An unexpected error occurred.' : e.message;
    return { status, code, message, errors: [], expected: status < 500 };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please quote the trace id when contacting support.', errors: [], expected: false };
}

/** Centralised error mapping. Internals (stack, SQL, connection strings) are logged, never returned. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const traceId = currentCorrelationId();
    const m = mapException(exception);
    if (!m.expected) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.log.error(`${m.code} traceId=${traceId} ${err.name}: ${err.message}`, err.stack);
    }
    if (res.headersSent) { res.end(); return; }
    res.status(m.status).json(failure(m.code, m.message, m.errors, traceId));
  }
}
