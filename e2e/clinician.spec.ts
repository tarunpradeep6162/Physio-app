import { expect, test } from '@playwright/test';
import { demoPrefs, enterDemo, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => demoPrefs(page));

test('demo clinic is labelled as demonstration data', async ({ page }) => {
  const w = watchErrors(page);
  await enterDemo(page, 'physiotherapist');
  await expect(page.getByText(/simulated/i).first()).toBeVisible();
  w.expectNone();
});

test('walk-in registration creates a patient record', async ({ page }) => {
  const w = watchErrors(page);
  await enterDemo(page, 'physiotherapist');
  await page.goto('/c/patients');
  await page.getByRole('button', { name: /Register patient/ }).first().click();
  await page.getByLabel('Full name').fill('Walk In E2E');
  await page.getByLabel(/Date of birth/).fill('1990-04-12');
  await page.getByLabel(/Mobile/).fill('9876543210');
  await page.getByRole('button', { name: 'Register patient', exact: true }).last().click();
  await expect(page.getByText('Walk In E2E').first()).toBeVisible();
  // A second record with the same mobile number is flagged before it is created.
  if (!(await page.getByLabel('Full name').isVisible())) await page.getByRole('button', { name: /Register patient/ }).first().click();
  await page.getByLabel('Full name').fill('Walk In Duplicate');
  await page.getByLabel(/Mobile/).fill('98765 43210');
  await expect(page.getByText(/Already registered with this number: Walk In E2E/)).toBeVisible();
  w.expectNone();
});

test('a submitted assessment opens for review with its report marked preliminary', async ({ page }) => {
  const w = watchErrors(page);
  await enterDemo(page, 'physiotherapist');
  await page.goto('/c/assessments');
  await page.getByRole('link', { name: /pending submitted/ }).first().click();
  await page.waitForURL('**/c/assessments/**');
  await page.getByRole('tab', { name: 'Report' }).click();
  await expect(page.getByText(/preliminary/i).first()).toBeVisible();
  w.expectNone();
});

test('no clinician screen is wider than a phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout check');
  const w = watchErrors(page);
  await enterDemo(page, 'physiotherapist');
  for (const path of ['/c/overview', '/c/patients', '/c/assessments', '/c/schedule', '/c/billing', '/c/programs/new', '/c/library', '/c/research', '/c/anatomy', '/c/analytics', '/c/settings']) {
    await page.goto(path);
    await page.locator('h1').first().waitFor();
    const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(width[0], `${path} scrollWidth`).toBeLessThanOrEqual(width[1]);
  }
  w.expectNone();
});

test('no patient screen is wider than a phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout check');
  const w = watchErrors(page);
  await enterDemo(page, 'patient');
  for (const path of ['/p/home', '/p/assess', '/p/train', '/p/progress', '/p/profile', '/p/desk']) {
    await page.goto(path);
    await page.locator('h1').first().waitFor();
    const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(width[0], `${path} scrollWidth`).toBeLessThanOrEqual(width[1]);
  }
  w.expectNone();
});
