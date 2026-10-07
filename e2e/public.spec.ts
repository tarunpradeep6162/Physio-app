import { expect, test } from '@playwright/test';
import { demoPrefs, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => demoPrefs(page));

test('public pages load and label the demo as simulated', async ({ page }) => {
  const w = watchErrors(page);
  await page.goto('/');
  await expect(page.getByText('Explore demo — patient')).toBeVisible();
  for (const path of ['/about', '/privacy']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
  }
  await page.goto('/privacy');
  await expect(page.getByText(/draft/i).first()).toBeVisible();
  w.expectNone();
});
