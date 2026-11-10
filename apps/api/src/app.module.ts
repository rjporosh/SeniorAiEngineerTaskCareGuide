import { Module } from '@nestjs/common';
import { loadConfig, type AppConfig } from './config/env.schema.js';
import { HealthController } from './health/health.controller.js';
import { HEALTH_PROBES } from './health/health.tokens.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Module({
  controllers: [HealthController],
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
    { provide: HEALTH_PROBES, useValue: [] },
  ],
  exports: [APP_CONFIG],
})
export class AppModule {}
