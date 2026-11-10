import type { Repositories } from '../../application/ports.js';
import type { AppConfig } from '../../config/env.schema.js';
import { createMemoryRepositories } from './memory/memory.repositories.js';

type DbConfig = Pick<AppConfig, 'DATABASE_PROVIDER' | 'DATABASE_URL' | 'MONGODB_URI'>;

/**
 * Selects the persistence adapter once, at bootstrap. Adapters are loaded lazily so that an
 * unused driver (Prisma, Mongoose) is never initialised.
 */
export async function createRepositories(cfg: DbConfig): Promise<Repositories> {
  switch (cfg.DATABASE_PROVIDER) {
    case 'postgres': {
      const { createPostgresRepositories } = await import('./postgres/postgres.repositories.js');
      return createPostgresRepositories(requireValue(cfg.DATABASE_URL, 'DATABASE_URL'));
    }
    case 'mongodb': {
      const { createMongoRepositories } = await import('./mongo/mongo.repositories.js');
      return createMongoRepositories(requireValue(cfg.MONGODB_URI, 'MONGODB_URI'));
    }
    case 'memory':
      return createMemoryRepositories();
  }
}

function requireValue(v: string | undefined, name: string): string {
  if (!v) throw new Error(`${name} is required`);
  return v;
}
