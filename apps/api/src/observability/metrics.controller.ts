import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { APP_CONFIG } from '../app.tokens.js';
import type { AppConfig } from '../config/env.schema.js';
import { Public, RawResponse } from '../common/decorators.js';
import { notFound, unauthorized } from '../common/errors.js';
import { AppMetrics } from './metrics.js';
import { OBS_METRICS } from './observability.tokens.js';

@Controller()
export class MetricsController {
  constructor(@Inject(OBS_METRICS) private readonly metrics: AppMetrics, @Inject(APP_CONFIG) private readonly cfg: Pick<AppConfig, 'METRICS_TOKEN'>) {}

  /** Disabled unless METRICS_TOKEN is set; scrapers must send it as a bearer token. */
  @Public() @RawResponse() @Get('metrics')
  async scrape(@Headers('authorization') auth: string | undefined, @Res() res: Response): Promise<void> {
    const token = this.cfg.METRICS_TOKEN;
    if (!token) throw notFound('Resource');
    const given = Buffer.from(auth?.replace(/^Bearer\s+/i, '') ?? '');
    const want = Buffer.from(token);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw unauthorized('Invalid metrics credentials', 'INVALID_TOKEN');
    res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(await this.metrics.registry.render());
  }
}
