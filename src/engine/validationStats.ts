/**
 * Agreement and repeatability statistics for the validation study (Phase 13).
 *
 * Pure functions, unit-tested against hand-computed values. They describe whatever data they are
 * given — there is no built-in accuracy claim. Results are only meaningful on a properly designed
 * evaluation set (see docs/validation/STUDY_PROTOCOL.md), analysed once, against thresholds fixed
 * in advance.
 */

export interface AgreementStats {
  n: number;
  /** Mean of (camera − reference). */
  bias: number;
  sdDiff: number;
  /** 95% limits of agreement (Bland–Altman): bias ± 1.96·SD. */
  loaLower: number;
  loaUpper: number;
  mae: number;
  rmse: number;
  /** Absolute errors at the 50th / 90th / 95th percentile. */
  absErrorP50: number;
  absErrorP90: number;
  absErrorP95: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const idx = p * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
};

/** Camera vs reference agreement on paired values. Needs n ≥ 2. */
export function agreement(pairs: { camera: number; reference: number }[]): AgreementStats | null {
  if (pairs.length < 2) return null;
  const d = pairs.map((p) => p.camera - p.reference);
  const ad = d.map(Math.abs);
  const bias = mean(d);
  const s = sd(d);
  return {
    n: pairs.length,
    bias,
    sdDiff: s,
    loaLower: bias - 1.96 * s,
    loaUpper: bias + 1.96 * s,
    mae: mean(ad),
    rmse: Math.sqrt(mean(d.map((x) => x * x))),
    absErrorP50: q(ad, 0.5),
    absErrorP90: q(ad, 0.9),
    absErrorP95: q(ad, 0.95),
  };
}

/**
 * ICC(2,1): two-way random effects, absolute agreement, single measurement (Shrout & Fleiss 1979;
 * McGraw & Wong 1996). `data[i][j]` = subject i, rater/session j. Complete rows only.
 */
export function icc21(data: number[][]): number | null {
  const rows = data.filter((r) => r.every((v) => Number.isFinite(v)));
  const n = rows.length;
  const k = rows[0]?.length ?? 0;
  if (n < 2 || k < 2) return null;
  const grand = mean(rows.flat());
  const rowMeans = rows.map(mean);
  const colMeans = Array.from({ length: k }, (_, j) => mean(rows.map((r) => r[j])));
  const ssr = k * rowMeans.reduce((a, m) => a + (m - grand) ** 2, 0);
  const ssc = n * colMeans.reduce((a, m) => a + (m - grand) ** 2, 0);
  const sst = rows.flat().reduce((a, v) => a + (v - grand) ** 2, 0);
  const sse = sst - ssr - ssc;
  const msr = ssr / (n - 1);
  const msc = ssc / (k - 1);
  const mse = sse / ((n - 1) * (k - 1));
  const denom = msr + (k - 1) * mse + (k * (msc - mse)) / n;
  return denom === 0 ? null : (msr - mse) / denom;
}

/** Test–retest repeatability from two sessions: ICC(2,1), SEM = SD·√(1−ICC), MDC95 = 1.96·√2·SEM. */
export function repeatability(pairs: { first: number; second: number }[]): { n: number; icc: number | null; sem: number | null; mdc95: number | null } {
  if (pairs.length < 2) return { n: pairs.length, icc: null, sem: null, mdc95: null };
  const icc = icc21(pairs.map((p) => [p.first, p.second]));
  const all = pairs.flatMap((p) => [p.first, p.second]);
  const sem = icc === null ? null : sd(all) * Math.sqrt(Math.max(0, 1 - icc));
  return { n: pairs.length, icc, sem, mdc95: sem === null ? null : 1.96 * Math.SQRT2 * sem };
}

/** Share of attempted captures that produced no valid value (capture failure rate). */
export function failureRate(attempts: { valid: boolean }[]): { n: number; failed: number; rate: number | null } {
  const failed = attempts.filter((a) => !a.valid).length;
  return { n: attempts.length, failed, rate: attempts.length ? failed / attempts.length : null };
}

/** Agreement per subgroup (e.g. device, lighting, clothing, skin-tone band), each with its own n. */
export function bySubgroup<T extends { camera: number; reference: number }>(pairs: T[], key: (p: T) => string): Record<string, AgreementStats | null> {
  const groups = new Map<string, T[]>();
  for (const p of pairs) groups.set(key(p), [...(groups.get(key(p)) ?? []), p]);
  return Object.fromEntries([...groups].map(([k, g]) => [k, agreement(g)]));
}

export interface ReleaseThreshold {
  metric: string;
  /** Required limits of agreement (absolute, in metric units) — both bounds within ±loa. */
  loaWithin: number;
  /** Maximum capture failure rate (0–1). */
  maxFailureRate: number;
  /** Minimum ICC(2,1) for test–retest. */
  minIcc: number;
  /** Minimum evaluation-set size before any decision. */
  minN: number;
}

/** Checks results against thresholds fixed BEFORE the evaluation set was analysed. */
export function checkRelease(t: ReleaseThreshold, a: AgreementStats | null, fr: { rate: number | null; n: number }, rep: { icc: number | null; n: number }): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!a || a.n < t.minN) reasons.push(`n = ${a?.n ?? 0} < ${t.minN} required`);
  else if (Math.max(Math.abs(a.loaLower), Math.abs(a.loaUpper)) > t.loaWithin) reasons.push(`limits of agreement ${a.loaLower.toFixed(1)} to ${a.loaUpper.toFixed(1)} exceed ±${t.loaWithin}`);
  if (fr.rate === null || fr.n < t.minN) reasons.push('capture failure rate not established');
  else if (fr.rate > t.maxFailureRate) reasons.push(`failure rate ${(fr.rate * 100).toFixed(0)}% > ${(t.maxFailureRate * 100).toFixed(0)}%`);
  if (rep.icc === null || rep.n < t.minN) reasons.push('repeatability not established');
  else if (rep.icc < t.minIcc) reasons.push(`ICC ${rep.icc.toFixed(2)} < ${t.minIcc}`);
  return { pass: reasons.length === 0, reasons };
}
