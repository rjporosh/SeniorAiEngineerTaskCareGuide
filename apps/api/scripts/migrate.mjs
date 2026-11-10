// Applies PostgreSQL migrations when DATABASE_PROVIDER=postgres; no-op otherwise.
import { spawnSync } from 'node:child_process';

const provider = process.env.DATABASE_PROVIDER ?? 'postgres';
if (provider !== 'postgres') {
  console.log(`[migrate] DATABASE_PROVIDER=${provider}: no SQL migrations to apply`);
  process.exit(0);
}
const r = spawnSync('node_modules/.bin/prisma', ['migrate', 'deploy'], { stdio: 'inherit', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' } });
process.exit(r.status ?? 1);
