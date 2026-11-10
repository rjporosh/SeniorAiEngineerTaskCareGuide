import { expect, test } from '@playwright/test';
import { join } from 'node:path';

test('mobile layout has no horizontal scroll and a bottom navigation', async ({ page }) => {
  for (const path of ['/', '/documents', '/upload', '/search']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
  await page.goto('/');
  await page.screenshot({ path: join(__dirname, '../screenshots/mobile-desk.png'), fullPage: true });
  const box = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
  expect(box!.y).toBeGreaterThan(300);
});
