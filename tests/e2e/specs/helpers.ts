import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export const ROOT = join(__dirname, '../../..');
export const FIXTURES = join(ROOT, 'fixtures/synthetic');

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const f = join(ROOT, '.env');
  return existsSync(f) ? new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync(f, 'utf8'))?.[1] : undefined;
}
export const ADMIN = { email: env('SEED_ADMIN_EMAIL') ?? 'admin@example.com', password: env('SEED_ADMIN_PASSWORD') ?? '' };

/** Interactive sign-in through the form (only for tests of the sign-in flow itself). */
export async function signIn(page: Page, who = ADMIN, opts: { stayOnPage?: boolean } = {}): Promise<void> {
  if (!opts.stayOnPage) await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
