import { expect, test, type Page } from '@playwright/test';
import { watchErrors } from './helpers';

// Phase 46: pseudo-localised text (accented, ~40% longer, bracketed) must not push any screen wider
// than a phone. Longer translations such as Tamil would otherwise clip or force sideways scrolling.

const setPrefs = (page: Page, locale: string) =>
  page.evaluate((l) => localStorage.setItem('physiovision.prefs', JSON.stringify({ poseProvider: 'simulated', voice: false, bodyMapMode: '2d', locale: l })), locale);

const fits = async (page: Page, path: string) => {
  await page.goto(path);
  await page.locator('h1').first().waitFor();
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, `${path} is wider than the screen with long text`).toBeLessThanOrEqual(cw);
};

for (const who of ['patient', 'physiotherapist'] as const) {
  test(`${who} screens fit a phone with long translated text`, async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'phone layout check');
    const w = watchErrors(page);
    // Enter the demo in English, then switch to the pseudo-locale.
    await page.goto('/');
    await setPrefs(page, 'en');
    await page.goto('/');
    await page.getByText(`Explore demo — ${who}`).click();
    await page.waitForURL(who === 'patient' ? '**/p/home' : '**/c/overview');
    await setPrefs(page, 'pseudo');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
    const paths = who === 'patient'
      ? ['/p/home', '/p/assess', '/p/train', '/p/progress', '/p/profile', '/p/desk']
      : ['/c/overview', '/c/patients', '/c/assessments', '/c/schedule', '/c/billing', '/c/library', '/c/analytics', '/c/settings'];
    for (const p of paths) await fits(page, p);
    w.expectNone();
  });
}
