#!/usr/bin/env node
/**
 * Build size report and budget check (Phase 43).
 *
 *   npm run build && npm run size [-- report.json]
 *
 * Sizes are gzip (level 9) of the files in dist/. "Initial JS" is what index.html loads before any
 * route: the entry script plus its modulepreloads. Budgets live in budgets.json and are set by the
 * product owner; a null budget is reported, never enforced. Exits non-zero only when a set budget
 * is exceeded. When GITHUB_STEP_SUMMARY is set, a Markdown table is appended there.
 */
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = process.cwd();
const dist = join(root, 'dist');
const OUT = process.argv[2] ?? 'size-report.json';
const { budgets } = JSON.parse(readFileSync(join(root, 'budgets.json'), 'utf8'));

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files = new Map();
for (const p of walk(dist)) {
  const buf = readFileSync(p);
  files.set('/' + relative(dist, p).split('\\').join('/'), { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length });
}
const kb = (b) => Math.round(b / 102.4) / 10;
const sum = (paths) => paths.reduce((n, p) => n + (files.get(p)?.gzip ?? 0), 0);
const by = (re) => [...files.keys()].filter((p) => re.test(p));

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const initial = [...html.matchAll(/<(?:script[^>]*src|link[^>]*rel="modulepreload"[^>]*href)="([^"]+\.js)"/g)].map((m) => m[1]);
const poseChunk = by(/^\/assets\/pose-runtime-.*\.js$/);

const measured = {
  initialJsGzipKB: kb(sum(initial)),
  allJsGzipKB: kb(sum(by(/^\/assets\/.*\.js$/))),
  cssGzipKB: kb(sum(by(/\.css$/))),
  anatomyLiteGzipKB: kb(sum(['/anatomy/anatomy-lite.glb', '/anatomy/skeleton-lite.glb'])),
  anatomyFullGzipKB: kb(sum(['/anatomy/anatomy.glb', '/anatomy/skeleton.glb'])),
  poseRuntimeGzipKB: kb(sum([...poseChunk, ...by(/^\/pose\/wasm\/.*\.(js|wasm)$/)])),
};

const rows = Object.entries(measured).map(([k, v]) => {
  const b = budgets[k] ?? null;
  return { measure: k, gzipKB: v, budgetKB: b, status: b === null ? 'no budget set' : v <= b ? 'within' : 'OVER' };
});
const largest = [...files.entries()].filter(([p]) => p.endsWith('.js')).sort((a, b) => b[1].gzip - a[1].gzip).slice(0, 8).map(([p, s]) => ({ file: p, gzipKB: kb(s.gzip) }));

console.log('measure'.padEnd(20), 'gzip KB'.padStart(9), 'budget'.padStart(8), ' status');
for (const r of rows) console.log(r.measure.padEnd(20), String(r.gzipKB).padStart(9), String(r.budgetKB ?? '–').padStart(8), '', r.status);
console.log('\nLargest JS chunks:');
for (const l of largest) console.log(' ', String(l.gzipKB).padStart(8), 'KB', l.file);

writeFileSync(OUT, JSON.stringify({ kind: 'dheepika-size-report', at: new Date().toISOString(), initialScripts: initial, rows, largest }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Build size (gzip)\n\n| Measure | KB | Budget | Status |\n|---|---:|---:|---|\n${rows.map((r) => `| ${r.measure} | ${r.gzipKB} | ${r.budgetKB ?? '–'} | ${r.status} |`).join('\n')}\n`);
}
const over = rows.filter((r) => r.status === 'OVER');
if (over.length) {
  console.error(`\n${over.length} budget(s) exceeded: ${over.map((r) => r.measure).join(', ')}`);
  process.exit(1);
}
