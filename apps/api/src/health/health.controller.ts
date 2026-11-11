import { Op, ApiTags } from '../common/openapi.js';
import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public, RawResponse } from '../common/decorators.js';
import { HEALTH_PROBES, type HealthProbe } from './health.tokens.js';

@ApiTags('Health')
@Public()
@RawResponse()
@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_PROBES) private readonly probes: HealthProbe[]) {}

  @Get('live') @Op('Liveness', { description: 'The process is up. Used by container healthchecks.', auth: false, errors: [] })
  live() {
    return { status: 'ok' };
  }

  @Get('ready') @Op('Readiness', { description: 'Checks database, queue, object storage and the document processor. 503 when any dependency is down.', auth: false, errors: [] })
  async ready(@Res({ passthrough: true }) res: Response) {
    const results = await Promise.all(
      this.probes.map(async (p) => {
        try {
          await p.check();
          return { name: p.name, status: 'up' as const };
        } catch {
          return { name: p.name, status: 'down' as const };
        }
      }),
    );
    const healthy = results.every((r) => r.status === 'up');
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: healthy ? 'ok' : 'degraded', checks: results };
  }
}
