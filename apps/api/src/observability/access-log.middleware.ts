import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { currentContext } from '../common/request-context.js';
import { AppLogger } from './logger.js';
import { AppMetrics } from './metrics.js';
import { OBS_LOGGER, OBS_METRICS } from './observability.tokens.js';

/** One structured access-log line and one metrics sample per request. Query strings are never logged (they may carry secrets). */
@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  constructor(@Inject(OBS_LOGGER) private readonly logger: AppLogger, @Inject(OBS_METRICS) private readonly metrics: AppMetrics) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : 'unmatched';
      const status = res.statusCode;
      this.metrics.httpRequests.inc({ method: req.method, route, status: `${Math.floor(status / 100)}xx` });
      this.metrics.httpDuration.observe({ method: req.method, route }, seconds);
      const probe = route.includes('/health/') || route.endsWith('/metrics');
      this.logger.event(status >= 500 ? 'error' : status >= 400 ? 'warn' : probe ? 'debug' : 'info',
        { context: 'http', method: req.method, path: req.path, route, status, durationMs: Math.round(seconds * 1000), bytes: Number(res.getHeader('content-length') ?? 0), ip: currentContext()?.ip ?? req.ip },
        `${req.method} ${req.path} ${status}`);
    });
    next();
  }
}
