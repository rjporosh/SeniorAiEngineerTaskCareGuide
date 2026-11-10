import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG } from './app.tokens.js';
import type { AppConfig } from './config/env.schema.js';
import type { Repositories } from './application/ports.js';
import { createRepositories } from './infrastructure/persistence/repositories.factory.js';
import type { HealthProbe } from './health/health.tokens.js';

export const REPOSITORIES = Symbol('REPOSITORIES');

@Global()
@Module({
  providers: [
    { provide: REPOSITORIES, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createRepositories(c) },
  ],
  exports: [REPOSITORIES],
})
export class PersistenceModule implements OnApplicationShutdown {
  constructor(@Inject(REPOSITORIES) private readonly repos: Repositories) {}
  async onApplicationShutdown(): Promise<void> { await this.repos.close(); }
}

export const databaseHealthProbe = (r: Repositories): HealthProbe => ({ name: `database:${r.provider}`, check: () => r.ping() });
