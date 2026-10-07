#!/usr/bin/env node
/**
 * Licence allow-list check over every package in package-lock.json (Phase 44).
 *
 *   node scripts/licence-check.mjs
 *
 * Reads only the lockfile (no network). Policy and reviewed exceptions: licence-policy.json.
 * Exits non-zero when a package's licence is missing or not satisfied by the allow-list.
 */
import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync('licence-policy.json', 'utf8'));
const allowed = new Set(policy.allowed);
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

/** Minimal SPDX expression check: OR binds looser than AND; "SEE LICENSE IN …" is never allowed. */
export function satisfied(expr, ok) {
  const e = expr.trim().replace(/^\((.*)\)$/, '$1');
  if (/\sOR\s/.test(e)) return e.split(/\s+OR\s+/).some((x) => satisfied(x, ok));
  if (/\sAND\s/.test(e)) return e.split(/\s+AND\s+/).every((x) => satisfied(x, ok));
  return ok.has(e.replace(/[()]/g, '').trim());
}

const problems = [];
const counts = new Map();
for (const [path, meta] of Object.entries(lock.packages ?? {})) {
  if (!path) continue;
  const name = path.replace(/^.*node_modules\//, '');
  const lic = meta.license ?? null;
  counts.set(lic ?? '(none)', (counts.get(lic ?? '(none)') ?? 0) + 1);
  if (policy.exceptions[name]) continue;
  if (!lic) problems.push(`${name}@${meta.version}: no licence declared`);
  else if (!satisfied(lic, allowed)) problems.push(`${name}@${meta.version}: ${lic}`);
}
for (const [lic, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), lic);
if (problems.length) {
  console.error(`\n${problems.length} package(s) need licence review:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`\nAll ${[...counts.values()].reduce((a, b) => a + b, 0)} packages satisfy the allow-list.`);
