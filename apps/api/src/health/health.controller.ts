import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public, RawResponse } from '../common/decorators.js';
import { HEALTH_PROBES, type HealthProbe } from './health.tokens.js';

@Public()
@RawResponse()
@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_PROBES) private readonly probes: HealthProbe[]) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
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
