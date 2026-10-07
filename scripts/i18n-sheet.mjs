#!/usr/bin/env node
/**
 * Translator sheet round trip for Tamil UI strings (Phase 46).
 *
 *   node scripts/i18n-sheet.mjs export [tamil-sheet.csv]   # one row per UI string
 *   node scripts/i18n-sheet.mjs import tamil-sheet.csv     # applies drafts and reviews
 *
 * Columns: key, area, english, tamil, status, reviewer, reviewed_on, notes. The translator edits
 * "tamil"; the qualified reviewer sets status=reviewed with their name and the date. Import is
 * all-or-nothing and refuses a sheet whose English no longer matches the app (re-export first),
 * a translation that drops or adds a {placeholder}, and a review without reviewer or date.
 * A changed Tamil string without a new review loses its old review (it is a draft again).
 *
 * Clinical questionnaires are NOT in this sheet: they are versioned instruments that need formal
 * translation, back-translation and clinical review (docs/I18N_REVIEW.md).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { en } from '../src/i18n/en.ts';
import { ta } from '../src/i18n/ta.ts';

const TA_FILE = new URL('../src/i18n/ta.ts', import.meta.url);
const REVIEW_FILE = new URL('../src/i18n/ta.review.json', import.meta.url);
const COLUMNS = ['key', 'area', 'english', 'tamil', 'status', 'reviewer', 'reviewed_on', 'notes'];

const reviews = JSON.parse(readFileSync(REVIEW_FILE, 'utf8'));
const state = (k) => (!ta[k] ? 'missing' : !reviews[k] ? 'draft' : reviews[k].en === en[k] && reviews[k].ta === ta[k] ? 'reviewed' : 'stale');
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const csvCell = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

function exportSheet(out) {
  const lines = [COLUMNS.join(',')];
  for (const k of Object.keys(en)) {
    const r = reviews[k];
    const st = state(k);
    lines.push([k, k.split('.')[0], en[k], ta[k] ?? '', st, st === 'reviewed' ? r.reviewer : '', st === 'reviewed' ? r.date : '', ''].map(csvCell).join(','));
  }
  // BOM so spreadsheet programs open the Tamil script as UTF-8.
  writeFileSync(out, '﻿' + lines.join('\r\n') + '\r\n');
  const counts = Object.keys(en).reduce((m, k) => ((m[state(k)] = (m[state(k)] ?? 0) + 1), m), {});
  console.log(`${out}: ${Object.keys(en).length} strings`, counts);
}

const quote = (v) => (v.includes("'") ? JSON.stringify(v) : `'${v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}'`);

function importSheet(file) {
  const [head, ...rows] = parseCsv(readFileSync(file, 'utf8'));
  const col = Object.fromEntries(COLUMNS.map((c) => [c, head.indexOf(c)]));
  const missingCols = COLUMNS.filter((c) => c !== 'notes' && col[c] < 0);
  if (missingCols.length) throw new Error(`sheet is missing columns: ${missingCols.join(', ')}`);
  const errors = [];
  const drafts = new Map();
  const newReviews = { ...reviews };
  let reviewed = 0, demoted = 0;
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    const get = (c) => (r[col[c]] ?? '').trim();
    const k = get('key');
    if (!(k in en)) { errors.push(`line ${line}: unknown key ${k}`); continue; }
    if (get('english') !== en[k].trim()) { errors.push(`line ${line}: ${k}: English changed since export; re-export the sheet`); continue; }
    const t = get('tamil');
    if (!t) continue;
    if (placeholders(t) !== placeholders(en[k])) { errors.push(`line ${line}: ${k}: placeholders {${placeholders(en[k])}} expected, got {${placeholders(t)}}`); continue; }
    if (t !== ta[k]) drafts.set(k, t);
    if (get('status') === 'reviewed') {
      const who = get('reviewer'), when = get('reviewed_on');
      if (!who || !/^\d{4}-\d{2}-\d{2}$/.test(when)) { errors.push(`line ${line}: ${k}: a review needs reviewer and reviewed_on (YYYY-MM-DD)`); continue; }
      newReviews[k] = { en: en[k], ta: t, reviewer: who, date: when };
      reviewed++;
    } else if (t !== ta[k] && newReviews[k]) {
      delete newReviews[k];
      demoted++;
    }
  }
  if (errors.length) {
    console.error(`Nothing imported. ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  // Rewrite ta.ts in place: existing keys keep their line, new keys are appended in English order.
  let src = readFileSync(TA_FILE, 'utf8');
  const added = [];
  for (const [k, v] of drafts) {
    const re = new RegExp(`^(\\s+)'${k.replace(/\./g, '\\.')}':.*$`, 'm');
    if (re.test(src)) src = src.replace(re, (_, ind) => `${ind}'${k}': ${quote(v)},`);
    else added.push(k);
  }
  if (added.length) {
    const order = Object.keys(en);
    added.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    src = src.replace(/\n};\s*$/, `\n${added.map((k) => `  '${k}': ${quote(drafts.get(k))},`).join('\n')}\n};\n`);
  }
  writeFileSync(TA_FILE, src);
  const sorted = Object.fromEntries(Object.keys(en).filter((k) => newReviews[k]).map((k) => [k, newReviews[k]]));
  writeFileSync(REVIEW_FILE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Imported: ${drafts.size} Tamil string(s) changed (${added.length} new), ${reviewed} review(s) recorded, ${demoted} old review(s) withdrawn because the Tamil changed.`);
  console.log('Next: npm test (checks placeholders and stale reviews), then node scripts/i18n-review.mjs.');
}

const [cmd, file] = process.argv.slice(2);
if (cmd === 'export') exportSheet(file ?? 'tamil-sheet.csv');
else if (cmd === 'import' && file) importSheet(file);
else {
  console.error('usage: node scripts/i18n-sheet.mjs export [file.csv] | import file.csv');
  process.exit(2);
}
