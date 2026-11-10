import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from './app.tokens.js';
import { loadConfig } from './config/env.schema.js';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
