import { expect, test, type Page } from '@playwright/test';
import { demoPrefs, enterDemo, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => demoPrefs(page));

/** New patient account up to the start of the knee assessment. */
async function signUpToAssessment(page: Page, email: string) {
  await page.goto('/auth?mode=signup');
  await page.getByLabel('Full name').fill('E2E Patient');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('supersecret1');
  // The pilot build refuses sign-up until the person acknowledges it is not for real patient data.
  await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /will not enter real patient health information/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/onboarding');
  await page.getByText('Continue').click();
  await page.getByText('I agree to on-device camera').click();
  await page.getByText('I agree to my measurements').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('textarea').first().fill('Left knee pain on stairs');
  await page.getByText('Start my assessment').click();
  await page.waitForURL('**/p/assess');
}

async function mapAndHistory(page: Page) {
  await page.locator('[aria-label="Left knee"]').first().click();
  await page.getByRole('group', { name: 'Part of knee' }).getByText('Front / kneecap').click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'How did it start?' }).getByText('Suddenly').click();
  await page.getByRole('radiogroup', { name: 'How long have you had these symptoms?' }).getByText('1–6 weeks').click();
  await page.getByRole('radiogroup', { name: 'Pain right now (0–10)' }).getByRole('radio', { name: '4', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Worst pain in the last 24 hours (0–10)' }).getByRole('radio', { name: '7', exact: true }).click();
  await page.getByLabel('What would you most like to be able to do again?').fill('Climb stairs without pain');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

test('knee assessment: intake → safety → simulated capture saved', async ({ page }, info) => {
  const w = watchErrors(page);
  await signUpToAssessment(page, `knee-${info.project.name}@example.com`);
  await mapAndHistory(page);
  for (const g of await page.getByRole('radiogroup').all()) await g.getByRole('radio', { name: 'No' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).first().click();
  await expect(page.getByText('Capture passed quality checks')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Save capture' }).click();
  w.expectNone();
});

test('a red-flag answer stops the assessment before any camera test', async ({ page }, info) => {
  const w = watchErrors(page);
  await signUpToAssessment(page, `flag-${info.project.name}@example.com`);
  await mapAndHistory(page);
  const groups = await page.getByRole('radiogroup').all();
  for (const g of groups) await g.getByRole('radio', { name: 'No' }).click();
  await groups[0].getByRole('radio', { name: 'Yes' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Seek emergency care now')).toBeVisible();
  await expect(page.getByText('Camera tests and exercise are paused.')).toBeVisible();
  // Sending the answers on must still not offer any camera test.
  await page.getByRole('button', { name: 'Continue to send to physiotherapist' }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  w.expectNone();
});

test('desk posture check produces results labelled for physiotherapist review', async ({ page }) => {
  const w = watchErrors(page);
  await enterDemo(page, 'patient');
  await page.goto('/p/desk');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('heading', { name: 'Desk posture check results' })).toBeVisible({ timeout: 60_000 });
  w.expectNone();
});
