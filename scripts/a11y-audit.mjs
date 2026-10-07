#!/usr/bin/env node
/**
 * Automated accessibility audit (Phase 39) with axe-core, WCAG 2.0/2.1/2.2 A and AA rules.
 * Visits the patient and clinician demo screens at phone (390 px) and desktop (1280 px) widths,
 * with reduced motion requested. Writes a JSON report and exits non-zero on serious or critical
 * violations.
 *
 * This finds machine-detectable problems only. It does not replace sessions with TalkBack /
 * VoiceOver users on real phones, which Phase 39 still requires.
 *
 *   npm run build && npm run serve          # in one terminal (http://localhost:4173)
 *   node scripts/a11y-audit.mjs [report.json]
 *
 * Needs Playwright with a Chromium build (not a project dependency). Set PLAYWRIGHT_CHROMIUM to a
 * browser executable if the default is not installed.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(join(globalRoot, 'playwright'));
  }
}
const { chromium } = loadPlaywright();
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.A11Y_URL ?? 'http://localhost:4173';
const OUT = process.argv[2] ?? 'a11y-report.json';

const PUBLIC = ['/', '/about', '/privacy', '/auth?mode=signin'];
const PATIENT = ['/p/home', '/p/assess/hip', '/p/train', '/p/progress', '/p/profile', '/p/desk'];
const CLINICIAN = ['/c/overview', '/c/patients', '/c/schedule', '/c/billing', '/c/programs/new', '/c/library', '/c/library/rom-guide', '/c/research', '/c/anatomy', '/c/analytics', '/c/settings', '/c/assessments', '/c/challenge'];

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const results = [];

async function audit(page, path, width) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => page.goto(BASE + path));
  await page.waitForTimeout(700);
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\n').slice(0, 3).join(' ') })) , count: v.nodes.length }));
  });
  results.push({ path, width, violations: r });
  const bad = r.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`${String(width).padStart(4)} ${path.padEnd(22)} ${r.length ? r.map((v) => `${v.impact}:${v.id}(${v.count})`).join(' ') : 'no violations'}${bad.length ? '  ←' : ''}`);
}

for (const width of [390, 1280]) {
  // bypassCSP lets the test harness inject axe; the app's own policy (which blocks inline script) is unchanged.
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, reducedMotion: 'reduce', bypassCSP: true });
  // Simulated camera and no voice: the audit never asks for device permissions. The 2D map keeps
  // the run light; the 3D model's controls are audited through the Anatomy page's own markup.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('physiovision.prefs', JSON.stringify({ poseProvider: 'simulated', voice: false, bodyMapMode: '2d' }));
    } catch {}
  });
  const page = await ctx.newPage();
  for (const p of PUBLIC) await audit(page, p, width);
  await page.goto(BASE + '/');
  await page.getByText('Explore demo — patient').click();
  await page.waitForURL('**/p/home');
  for (const p of PATIENT) await audit(page, p, width);
  await page.goto(BASE + '/p/profile');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(BASE + '/');
  await page.getByText('Explore demo — physiotherapist').click();
  await page.waitForURL('**/c/overview');
  for (const p of CLINICIAN) await audit(page, p, width);
  await ctx.close();
}
await browser.close();

writeFileSync(OUT, JSON.stringify({ kind: 'dheepika-a11y-audit', base: BASE, at: new Date().toISOString(), results }, null, 1));
const serious = results.flatMap((r) => r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${r.width} ${r.path} ${v.id}`));
console.log(`\n${results.length} screens audited; ${serious.length} serious/critical violation(s). Report: ${OUT}`);
process.exit(serious.length ? 1 : 0);
