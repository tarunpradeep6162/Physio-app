import { expect, test } from '@playwright/test';
import { demoPrefs, enterDemo, watchErrors } from './helpers';

// Phases 47–52 in the browser with demo data and the simulated camera.
test.beforeEach(async ({ page }) => demoPrefs(page));

test('patient sets a goal in their own words and rates it', async ({ page }) => {
  const w = watchErrors(page);
  await enterDemo(page, 'patient');
  await page.goto('/p/progress');
  await page.getByLabel('Add a goal').fill('Walk to the temple without stopping');
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page.getByText('“Walk to the temple without stopping”')).toBeVisible();
  await page.getByRole('radiogroup', { name: /Progress towards: Walk to the temple/ }).getByRole('radio', { name: '4', exact: true }).click();
  await page.getByRole('button', { name: 'Save rating' }).click();
  await expect(page.getByText(/last rated 4\/10/)).toBeVisible();
  w.expectNone();
});

test('clinician: SOAP note with a labelled quote, then a correction that keeps the original', async ({ page }) => {
  const w = watchErrors(page);
  await enterDemo(page, 'physiotherapist');
  await page.goto('/c/patients');
  await page.getByRole('link', { name: /Demo patient DP-01/ }).first().click();
  await page.getByRole('tab', { name: 'Clinical notes' }).click();
  await page.getByLabel('S — Subjective').fill('Stairs painful going down');
  await page.getByLabel('P — Plan').fill('Continue programme; reassess in 2 weeks');
  await page.getByText('Quote measurements').click();
  await page.getByRole('button', { name: 'Camera estimate' }).click();
  await page.locator('.panel input[type=checkbox]').first().check();
  await page.getByRole('button', { name: 'Save note' }).click();
  const note = page.locator('article').filter({ hasText: 'Stairs painful going down' }).first();
  await expect(note.getByText(/\[Camera estimate/)).toBeVisible();
  await note.getByRole('button', { name: 'Correct this note' }).click();
  await page.getByLabel('S — Subjective').fill('Stairs painful going down and up');
  await page.getByRole('button', { name: 'Save correction' }).click();
  const corrected = page.locator('article').filter({ hasText: 'Stairs painful going down and up' }).first();
  await expect(corrected.getByText('Earlier versions (1)')).toBeVisible();
  w.expectNone();
});

test('clinician: letter draft → signed → new version; goals tab', async ({ page }) => {
  const w = watchErrors(page);
  await enterDemo(page, 'physiotherapist');
  await page.goto('/c/patients');
  await page.getByRole('link', { name: /Demo patient DP-01/ }).first().click();
  await page.getByRole('tab', { name: 'Letters' }).click();
  await page.getByRole('button', { name: 'New letter' }).click();
  await page.getByRole('button', { name: 'Sign letter' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Add the recipient' })).toBeVisible();
  await page.getByLabel('To', { exact: true }).fill('Orthopaedic outpatient clinic');
  await page.getByLabel('Letter', { exact: true }).fill('Thank you for seeing this patient. Progress has plateaued.');
  await page.getByRole('button', { name: 'Sign letter' }).click();
  const letter = page.locator('article').filter({ hasText: 'Orthopaedic outpatient clinic' }).first();
  await expect(letter.getByText(/^Signed /)).toBeVisible();
  await expect(letter.getByRole('button', { name: 'Edit draft' })).toHaveCount(0);
  await letter.getByRole('button', { name: 'New version' }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('New version of a letter signed earlier.')).toBeVisible();
  await page.getByRole('tab', { name: 'Goals' }).click();
  await page.getByLabel('Record a goal in the patient’s words').fill('Return to badminton');
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page.getByText('“Return to badminton”')).toBeVisible();
  w.expectNone();
});

test('clinician: a questionnaire cannot be switched on before licence and approval are recorded', async ({ page }) => {
  const w = watchErrors(page);
  await enterDemo(page, 'physiotherapist');
  await page.goto('/c/settings');
  await page.getByLabel('Questionnaire name').fill('Example knee questionnaire');
  await page.getByLabel('Version', { exact: true }).fill('1.0');
  await page.getByRole('button', { name: 'Add to registry' }).click();
  await page.getByText('Example knee questionnaire').click();
  await expect(page.getByRole('button', { name: 'Start using' })).toBeDisabled();
  await expect(page.getByText('No clinical approval of this version')).toBeVisible();
  w.expectNone();
});

test('clinician: capture quality panel and challenge recorder (simulated clips never export)', async ({ page }) => {
  const w = watchErrors(page);
  await enterDemo(page, 'physiotherapist');
  await page.goto('/c/analytics');
  await expect(page.getByRole('heading', { name: 'Where capture fails' })).toBeVisible();
  await page.getByRole('link', { name: 'occlusion challenge recorder' }).click();
  await page.getByLabel('Participant code (no names)').fill('V-01');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'left elbow' }).click();
  await page.getByRole('button', { name: 'Open camera' }).click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.waitForTimeout(1500);
  const hold = page.getByRole('button', { name: 'Hold while the occluder is in place' });
  await hold.dispatchEvent('pointerdown');
  await page.waitForTimeout(1500);
  await hold.dispatchEvent('pointerup');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('heading', { name: 'Review clip' })).toBeVisible();
  await page.getByRole('button', { name: 'Save clip' }).click();
  await expect(page.locator('.badge.demo', { hasText: 'simulated' })).toBeVisible();
  await page.getByRole('button', { name: 'Export (JSON)' }).click();
  await expect(page.getByText('No unlocked clips from a real camera to export.')).toBeVisible();
  w.expectNone();
});
