import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys (Phase 42) against the production build, demo data and the SIMULATED camera.
 * They prove the software flows complete and the safety routing still works; they say nothing about
 * measurement accuracy. Run: npm run build && npm run e2e
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: { command: 'node scripts/serve-dist.mjs', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
});
