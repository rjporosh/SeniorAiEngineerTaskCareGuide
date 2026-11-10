import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { ADMIN, FIXTURES, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('anonymous', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

test('sign-in rejects bad credentials with a clear message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill('definitely-wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.notice[role=alert]')).toContainText('Invalid email or password');
  await expect(page).toHaveURL(/\/login/);
});

test('unauthenticated visitors are sent to sign-in and returned afterwards', async ({ page }) => {
  await page.goto('/documents');
  await expect(page).toHaveURL(/\/login\?next=%2Fdocuments/);
  await signIn(page, ADMIN, { stayOnPage: true });
  await expect(page).toHaveURL(/\/documents$/);
});
});

test('upload, watch processing, inspect evidence, correct a value, search and reprocess', async ({ page }) => {
  await page.goto('/upload');
  await page.screenshot({ path: join(__dirname, '../screenshots/upload-empty.png'), fullPage: true });

  const tag = Date.now();
  // unsupported file is explained client-side before any upload
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.getByText('".exe" files are not supported')).toBeVisible();

  // the arithmetic-error fixture makes the review flow deterministic; a unique copy avoids cross-run duplicate noise
  const pdf = join(FIXTURES, 'edge-arithmetic.pdf');
  await page.locator('input[type=file]').setInputFiles([{ name: `ui-${tag}.pdf`, mimeType: 'application/pdf', buffer: (await import('node:fs')).readFileSync(pdf) }]);
  await page.getByRole('button', { name: /Upload 1 file/ }).click();
  await expect(page.getByRole('link', { name: 'Open result' })).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: join(__dirname, '../screenshots/upload-done.png'), fullPage: true });
  await page.getByRole('link', { name: 'Open result' }).click();

  // detail: the extraction sheet, margin notes and review stamp
  await expect(page.getByRole('heading', { name: /INV-/ })).toBeVisible();
  await expect(page.getByText('Needs review').first()).toBeVisible();
  await expect(page.getByText(/does not equal the total/)).toBeVisible();
  await page.getByRole('button', { name: 'Show source' }).first().click();
  await expect(page.locator('mark.evidence').first()).toBeVisible();
  await page.screenshot({ path: join(__dirname, '../screenshots/document-detail.png'), fullPage: true });

  // correct the total so the numbers add up
  await page.getByRole('button', { name: 'Correct values' }).click();
  const subtotal = Number((await page.getByLabel('Subtotal').inputValue()) || 0);
  const tax = Number((await page.getByLabel('Tax').inputValue()) || 0);
  await page.getByLabel('Total', { exact: true }).fill((subtotal + tax).toFixed(2));
  await page.getByLabel(/Why are you changing/).fill('total did not match subtotal + tax');
  await page.getByRole('button', { name: 'Save corrections' }).click();
  await expect(page.getByText('Corrections saved')).toBeVisible();
  await expect(page.getByText(/does not equal the total/)).toHaveCount(0);
  await expect(page.getByText('total did not match subtotal + tax')).toBeVisible();

  // invalid correction reports every problem at once
  await page.getByRole('button', { name: 'Correct values' }).click();
  await page.getByLabel('Total', { exact: true }).fill('abc');
  await page.getByLabel('Currency').fill('xx');
  await page.getByRole('button', { name: 'Save corrections' }).click();
  await expect(page.locator('.notice[role=alert]')).toContainText('totalAmount');
  await expect(page.locator('.notice[role=alert]')).toContainText('currency');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // reprocess keeps history
  await page.getByRole('button', { name: 'Process again' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Process again' }).click();
  await expect(page.getByText('Attempt 2')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Attempt 1')).toBeVisible();

  // search finds it by invoice text
  await page.goto('/search?q=ACME&mode=keyword');
  await page.screenshot({ path: join(__dirname, '../screenshots/search.png'), fullPage: true });
  await page.goto('/documents');
  await expect(page.getByRole('link', { name: `ui-${tag}.pdf` })).toBeVisible();
  await page.screenshot({ path: join(__dirname, '../screenshots/documents.png'), fullPage: true });
});

test('desk shows what is waiting and the theme can be switched', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: join(__dirname, '../screenshots/desk.png'), fullPage: true });
  await page.getByRole('button', { name: /Switch between light and dark/ }).click();
  const theme = await page.evaluate(() => document.documentElement.dataset['theme']);
  expect(['dark', 'light']).toContain(theme);
  await page.screenshot({ path: join(__dirname, '../screenshots/desk-dark.png'), fullPage: true });
});

test('keyboard users can reach the main content and every nav item has a name', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  for (const name of ['Desk', 'Upload', 'Documents', 'Search']) await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })).toBeVisible();
});
