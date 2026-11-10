import { request, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ADMIN } from './specs/helpers';

/** One real sign-in for the whole run (the login endpoint is rate limited, as it should be). */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:4001';
  const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL, 'x-requested-with': 'docint' } });
  const res = await ctx.post('/api/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } });
  if (!res.ok()) throw new Error(`global sign-in failed (${res.status()}); is the stack running and SEED_ADMIN_* set?`);
  mkdirSync('.auth', { recursive: true });
  await ctx.storageState({ path: '.auth/admin.json' });
  await ctx.dispose();
}
