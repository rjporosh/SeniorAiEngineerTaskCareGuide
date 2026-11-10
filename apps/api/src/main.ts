import 'reflect-metadata';
import { AppModule } from './app.module.js';
import { APP_CONFIG } from './app.tokens.js';
import { configureApp, createApp, setupDocs } from './bootstrap.js';
import type { AppConfig } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await createApp(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  setupDocs(app, config.NODE_ENV !== 'production' || config.API_DOCS_ENABLED);
  await app.listen(config.PORT, '0.0.0.0');
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
