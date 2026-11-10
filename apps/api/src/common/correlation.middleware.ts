import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithContext } from './request-context.js';

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;
export const CORRELATION_HEADER = 'x-correlation-id';

/** Accepts a well-formed inbound id (never trusts arbitrary content), otherwise generates one. */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(CORRELATION_HEADER) ?? req.header('x-request-id');
  const correlationId = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader(CORRELATION_HEADER, correlationId);
  runWithContext({ correlationId, ip: req.ip }, next);
}
