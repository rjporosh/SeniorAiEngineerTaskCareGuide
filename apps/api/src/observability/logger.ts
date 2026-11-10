import type { LoggerService } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { pino, type Logger as Pino, type LoggerOptions } from 'pino';
import { currentContext } from '../common/request-context.js';
import { REDACT_PATHS, redactString } from './redact.js';

export function createPino(level: string, service: string, destination?: LoggerOptions['transport']): Pino {
  return pino({
    level, base: { service }, timestamp: pino.stdTimeFunctions.isoTime, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: { level: (label) => ({ level: label }) },
    mixin() {
      const ctx = currentContext();
      const span = trace.getActiveSpan()?.spanContext();
      return { ...(ctx?.correlationId && { correlationId: ctx.correlationId }), ...(ctx?.userId && { userId: ctx.userId }), ...(span && { traceId: span.traceId, spanId: span.spanId }) };
    },
    ...(destination && { transport: destination }),
  });
}

/** Nest LoggerService backed by pino: one JSON object per line on stdout, correlation-aware and credential-safe. */
export class AppLogger implements LoggerService {
  constructor(private readonly pino: Pino) {}
  private write(level: 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'fatal', message: unknown, params: unknown[]): void {
    const context = typeof params.at(-1) === 'string' ? (params.at(-1) as string) : undefined;
    const extra = params.slice(0, context ? -1 : undefined);
    const stack = level === 'error' || level === 'fatal' ? extra.find((p): p is string => typeof p === 'string') : undefined;
    const msg = redactString(typeof message === 'string' ? message : message instanceof Error ? message.message : JSON.stringify(message));
    this.pino[level]({ ...(context && { context }), ...(stack && { stack: redactString(stack) }) }, msg);
  }
  log(m: unknown, ...p: unknown[]) { this.write('info', m, p); }
  error(m: unknown, ...p: unknown[]) { this.write('error', m, p); }
  warn(m: unknown, ...p: unknown[]) { this.write('warn', m, p); }
  debug(m: unknown, ...p: unknown[]) { this.write('debug', m, p); }
  verbose(m: unknown, ...p: unknown[]) { this.write('trace', m, p); }
  fatal(m: unknown, ...p: unknown[]) { this.write('fatal', m, p); }
  /** Structured event with first-class fields (used by the access log). */
  event(level: 'info' | 'warn' | 'error' | 'debug', fields: Record<string, unknown>, message: string): void { this.pino[level](fields, message); }
}
