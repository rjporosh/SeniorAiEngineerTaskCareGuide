import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG } from './app.tokens.js';
import type { AppConfig } from './config/env.schema.js';
import type { Repositories } from './application/ports.js';
import { createRepositories } from './infrastructure/persistence/repositories.factory.js';
import { HEALTH_PROBES } from './health/health.tokens.js';

export const REPOSITORIES = Symbol('REPOSITORIES');

@Global()
@Module({
  providers: [
    { provide: REPOSITORIES, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createRepositories(c) },
    {
      provide: HEALTH_PROBES, inject: [REPOSITORIES],
      useFactory: (r: Repositories) => [{ name: `database:${r.provider}`, check: () => r.ping() }],
    },
  ],
  exports: [REPOSITORIES, HEALTH_PROBES],
})
export class PersistenceModule implements OnApplicationShutdown {
  constructor(@Inject(REPOSITORIES) private readonly repos: Repositories) {}
  async onApplicationShutdown(): Promise<void> { await this.repos.close(); }
}
