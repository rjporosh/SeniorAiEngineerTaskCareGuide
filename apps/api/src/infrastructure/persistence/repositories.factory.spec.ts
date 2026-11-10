import { describe, expect, it } from 'vitest';
import { createRepositories } from './repositories.factory.js';

describe('createRepositories', () => {
  it('selects the in-memory adapter by configuration only', async () => {
    const r = await createRepositories({ DATABASE_PROVIDER: 'memory' });
    expect(r.provider).toBe('memory');
    await r.ping();
    await r.close();
  });
  it('reports missing connection settings', async () => {
    await expect(createRepositories({ DATABASE_PROVIDER: 'postgres' })).rejects.toThrow(/DATABASE_URL/);
    await expect(createRepositories({ DATABASE_PROVIDER: 'mongodb' })).rejects.toThrow(/MONGODB_URI/);
  });
});
