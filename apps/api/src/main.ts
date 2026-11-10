import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { APP_CONFIG } from './app.tokens.js';
import type { AppConfig } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix('api/v1', { exclude: [] });
  app.enableCors({ origin: config.CORS_ORIGINS });
  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
