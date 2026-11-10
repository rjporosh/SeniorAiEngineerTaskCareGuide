import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from './app.tokens.js';
import type { AppConfig } from './config/env.schema.js';
import type { ObjectStoragePort } from './application/storage.js';
import { createStorage } from './infrastructure/storage/storage.factory.js';
import type { HealthProbe } from './health/health.tokens.js';

export const STORAGE = Symbol('STORAGE');

@Global()
@Module({
  providers: [{ provide: STORAGE, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createStorage(c) }],
  exports: [STORAGE],
})
export class StorageModule {}

export const storageHealthProbe = (s: ObjectStoragePort): HealthProbe => ({ name: `storage:${s.provider}`, check: () => s.ping() });
