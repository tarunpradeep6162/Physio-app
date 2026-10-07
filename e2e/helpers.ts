import { expect, type Page } from '@playwright/test';

/** Simulated camera, no voice, 2D map: the journeys never ask for device permissions or WebGL. */
export async function demoPrefs(page: Page) {
  await page.addInitScript(() => {
    try {
      const prev = JSON.parse(localStorage.getItem('physiovision.prefs') ?? '{}');
      localStorage.setItem('physiovision.prefs', JSON.stringify({ ...prev, poseProvider: 'simulated', voice: false, bodyMapMode: '2d' }));
    } catch {
      /* storage blocked: the app falls back to defaults */
    }
  });
}

/** Collect uncaught page errors and console errors; each test asserts none occurred. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return {
    errors,
    expectNone: () => expect(errors, errors.join('\n')).toEqual([]),
  };
}

export async function enterDemo(page: Page, who: 'patient' | 'physiotherapist') {
  await page.goto('/');
  await page.getByText(`Explore demo — ${who}`).click();
  await page.waitForURL(who === 'patient' ? '**/p/home' : '**/c/overview');
}
