import type { CaptureSession, DailyCheckin, DB, ID } from '../data/models';
import { compareConfig } from '../engine/protocols/recorder';
import { dailyActivity } from '../integrations/activity';
import { activityConsent } from '../integrations/activityStore';
import { capturesFor } from './evidence';
import { latestApprovedPlan } from './plan';
import { programExercises } from '../data/queries';

/**
 * Clinician intelligence and longitudinal trends (Phase 17).
 *
 * A trend is a list of ABSOLUTE values, each with its source, protocol + algorithm version, view,
 * setup and validity. A change is only computed between comparable neighbours. Anything else
 * BREAKS the trend with the reason shown: an invalid or missing capture, a different protocol or
 * algorithm version, a different view, or a setup that does not match the previous capture.
 *
 * The exception queue applies clinic-configurable rules. Each rule's threshold is an operational
 * default until a clinician reviews it (who/when recorded); changing a threshold clears the
 * review. Nothing here is a clinical norm, diagnosis or risk score.
 */

export const TRENDS_VERSION = 'dl-trends-1.0.0';

export interface TrendPoint {
  assessmentId: ID;
  at: string;
  value: number | null;
  unit: string;
  validity: 'valid' | 'invalid' | 'missing';
  reason?: string;
  protocol: string;
  algorithm: string;
  view: string;
  source: 'camera_estimate';
  simulated: boolean;
  captureId?: ID;
}

export interface TrendLink {
  from: number;
  to: number;
  comparable: boolean;
  change: number | null;
  breakReason?: string;
}

export interface MetricTrend {
  protocolId: string;
  metricId: string;
  side: 'left' | 'right' | null;
  points: TrendPoint[];
  links: TrendLink[];
}

/** Minimum share of setup checks (view, orientation, distance, position, tilt) that must match. */
export const DEFAULT_MIN_SETUP_MATCH = 0.8;

export function metricTrend(db: DB, patientId: ID, protocolId: string, metricId: string, side: 'left' | 'right' | null, minSetupMatch = DEFAULT_MIN_SETUP_MATCH): MetricTrend {
  const assessments = db.assessments.filter((a) => a.patientId === patientId && a.status !== 'in_progress').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const caps: (CaptureSession | undefined)[] = [];
  const points: TrendPoint[] = [];
  for (const a of assessments) {
    const all = capturesFor(db, a.id).filter((c) => c.protocolId === protocolId && c.side === side);
    if (!db.captures.some((c) => c.assessmentId === a.id && c.protocolId === protocolId)) continue; // this assessment did not include the test at all
    const c = all[0];
    const m = c?.result.metrics.find((x) => x.id === metricId);
    const ok = !!c && c.result.quality.verdict === 'valid' && m?.validity === 'valid' && m.value !== null;
    caps.push(c);
    points.push({
      assessmentId: a.id,
      at: c?.createdAt ?? a.createdAt,
      value: ok ? m!.value : null,
      unit: m?.unit ?? 'deg',
      validity: !c ? 'missing' : ok ? 'valid' : 'invalid',
      reason: !c ? 'Not captured for this side' : ok ? undefined : (m?.reason ?? c.result.quality.reasons.join('; ')),
      protocol: c ? `${protocolId}@${c.protocolVersion}` : protocolId,
      algorithm: c?.result.algorithmVersion ?? '—',
      view: c?.result.view ?? '—',
      source: 'camera_estimate',
      simulated: c?.provenance.source === 'simulated_demo' || !!c?.isDemo,
      captureId: c?.id,
    });
  }
  const links: TrendLink[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    let why: string | undefined;
    if (a.validity !== 'valid' || b.validity !== 'valid') why = `${a.validity !== 'valid' ? 'earlier' : 'later'} value ${a.validity !== 'valid' ? a.validity : b.validity}`;
    else if (a.protocol !== b.protocol) why = `protocol changed (${a.protocol} → ${b.protocol})`;
    else if (a.algorithm !== b.algorithm) why = `algorithm changed (${a.algorithm} → ${b.algorithm})`;
    else if (a.view !== b.view) why = `camera view changed (${a.view} → ${b.view})`;
    else {
      const ca = caps[i - 1]?.config;
      const cb = caps[i]?.config;
      if (!ca || !cb) why = 'setup not recorded';
      else {
        const match = compareConfig(ca, cb);
        if (match.score < minSetupMatch) why = `setup differs (${match.checks.filter((c) => !c.match).map((c) => c.label.toLowerCase()).join(', ')})`;
      }
    }
    links.push({ from: i - 1, to: i, comparable: !why, change: why ? null : Math.round((b.value! - a.value!) * 10) / 10, breakReason: why });
  }
  return { protocolId, metricId, side, points, links };
}

/** Pain over time from the patient's own reports, each with its source. */
export function symptomTrend(db: DB, patientId: ID): { at: string; nprs: number; source: 'daily_checkin' | 'intake_now' | 'session_before' }[] {
  const out: { at: string; nprs: number; source: 'daily_checkin' | 'intake_now' | 'session_before' }[] = [];
  for (const p of db.pros) if (p.patientId === patientId && p.type === 'daily_checkin') out.push({ at: p.recordedAt, nprs: (p.value as DailyCheckin).pain, source: 'daily_checkin' });
  for (const r of db.intakeAnswers) if (r.patientId === patientId && r.questionId === 'nprs_now' && typeof r.answer === 'number' && !r.supersededBy) out.push({ at: r.answeredAt, nprs: r.answer, source: 'intake_now' });
  for (const s of db.sessions) if (s.patientId === patientId && s.painBefore !== undefined) out.push({ at: s.startedAt, nprs: s.painBefore, source: 'session_before' });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Weekly sessions done vs planned for the current plan (weeks ending at `now`). */
export function adherenceTrend(db: DB, patientId: ID, now: string, weeks = 6): { weekEnding: string; done: number; planned: number | null }[] {
  const prog = latestApprovedPlan(db, patientId);
  const freq = prog ? Math.max(0, ...programExercises(db, prog.id).map((e) => e.prescription.frequencyPerWeek), ...(db.programLibraryItems ?? []).filter((l) => l.programId === prog.id).map((l) => l.frequencyPerWeek)) : 0;
  const end = Date.parse(now);
  return Array.from({ length: weeks }, (_, k) => {
    const hi = end - k * 7 * 86_400_000;
    const lo = hi - 7 * 86_400_000;
    const done = db.sessions.filter((s) => s.patientId === patientId && Date.parse(s.startedAt) > lo && Date.parse(s.startedAt) <= hi).length;
    const started = prog ? Date.parse(`${prog.startDate}T00:00:00`) : Infinity;
    return { weekEnding: new Date(hi).toISOString().slice(0, 10), done, planned: prog && hi > started ? freq : null };
  }).reverse();
}

/** Weekly median daily steps (only days with data; null when fewer than `minDays` days of data). */
export function activityTrend(db: DB, patientId: ID, now: string, weeks = 6, minDays = 4): { weekEnding: string; medianSteps: number | null; daysWithData: number }[] {
  if (!activityConsent(db, patientId, 'steps').granted) return [];
  const samples = db.activitySamples.filter((s) => s.patientId === patientId);
  const end = new Date(now);
  return Array.from({ length: weeks }, (_, k) => {
    const days = Array.from({ length: 7 }, (_, d) => new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate() - k * 7 - d)).toISOString().slice(0, 10));
    const vals = dailyActivity(samples, 'steps', days).map((d) => d.value).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const med = vals.length ? vals[Math.floor(vals.length / 2)] : null;
    return { weekEnding: days[0], medianSteps: vals.length >= minDays ? med : null, daysWithData: vals.length };
  }).reverse();
}

// ---- Exception queue ------------------------------------------------------------------------

export interface ExceptionRule {
  id: 'pain_rise' | 'low_adherence' | 'no_contact' | 'rom_decrease' | 'repeat_invalid' | 'activity_drop';
  label: string;
  /** Threshold value in `unit`. */
  threshold: number;
  unit: string;
  enabled: boolean;
  /** Set when a clinician reviews this rule at this threshold. */
  reviewedBy?: string;
  reviewedAt?: string;
}

/** Operational defaults — NOT clinical norms. Shown as "unreviewed" until a clinician reviews them. */
export const DEFAULT_EXCEPTION_RULES: ExceptionRule[] = [
  { id: 'pain_rise', label: 'Latest check-in pain above the patient’s previous 7-day median by at least', threshold: 2, unit: 'points', enabled: true },
  { id: 'low_adherence', label: 'Sessions in the last 14 days below this share of planned', threshold: 50, unit: '%', enabled: true },
  { id: 'no_contact', label: 'No check-in or session for at least', threshold: 7, unit: 'days', enabled: true },
  { id: 'rom_decrease', label: 'Comparable camera value lower than the previous comparable value by at least', threshold: 10, unit: '° / unit', enabled: true },
  { id: 'repeat_invalid', label: 'Invalid captures in the latest assessment, at least', threshold: 2, unit: 'captures', enabled: true },
  { id: 'activity_drop', label: 'Weekly median steps lower than the previous week by at least (both weeks ≥ 4 days of data)', threshold: 30, unit: '%', enabled: true },
];

export interface ExceptionItem {
  patientId: ID;
  ruleId: ExceptionRule['id'];
  ruleReviewed: boolean;
  summary: string;
  /** The values that triggered it, with their source. */
  evidence: string[];
  at: string;
}

export function exceptionQueue(db: DB, rules: ExceptionRule[], now: string, trendRows: (patientId: ID) => { protocolId: string; metricId: string; side: 'left' | 'right' | null }[]): ExceptionItem[] {
  const out: ExceptionItem[] = [];
  const nowMs = Date.parse(now);
  const on = (id: ExceptionRule['id']) => rules.find((r) => r.id === id && r.enabled);
  for (const p of db.patients) {
    const push = (r: ExceptionRule, summary: string, evidence: string[], at = now) => out.push({ patientId: p.id, ruleId: r.id, ruleReviewed: !!r.reviewedBy, summary, evidence, at });
    const r1 = on('pain_rise');
    if (r1) {
      const cis = db.pros.filter((x) => x.patientId === p.id && x.type === 'daily_checkin').sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      const last = cis.at(-1);
      if (last) {
        const prev = cis.filter((c) => c !== last && Date.parse(c.recordedAt) >= Date.parse(last.recordedAt) - 7 * 86_400_000).map((c) => (c.value as DailyCheckin).pain).sort((a, b) => a - b);
        const med = prev.length ? prev[Math.floor(prev.length / 2)] : null;
        const v = (last.value as DailyCheckin).pain;
        if (med !== null && v - med >= r1.threshold) push(r1, `Check-in pain ${v}/10 vs previous 7-day median ${med}/10`, [`daily check-in ${last.recordedAt.slice(0, 10)} (patient-reported): ${v}/10`, `${prev.length} earlier check-in(s) in 7 days`], last.recordedAt);
      }
    }
    const prog = latestApprovedPlan(db, p.id);
    const r2 = on('low_adherence');
    if (r2 && prog) {
      const freq = Math.max(0, ...programExercises(db, prog.id).map((e) => e.prescription.frequencyPerWeek), ...(db.programLibraryItems ?? []).filter((l) => l.programId === prog.id).map((l) => l.frequencyPerWeek));
      const from = Math.max(nowMs - 14 * 86_400_000, Date.parse(`${prog.startDate}T00:00:00`));
      const days = (nowMs - from) / 86_400_000;
      if (days >= 7 && freq > 0) {
        const planned = Math.round((freq * days) / 7);
        const done = db.sessions.filter((s) => s.patientId === p.id && Date.parse(s.startedAt) >= from).length;
        if (planned > 0 && (done / planned) * 100 < r2.threshold) push(r2, `${done} of ${planned} planned sessions in the last ${Math.round(days)} days`, [`plan ${prog.title} v${prog.version ?? 1}, ${freq}/week`]);
      }
    }
    const r3 = on('no_contact');
    if (r3 && prog) {
      const lastTouch = [...db.pros.filter((x) => x.patientId === p.id && x.type === 'daily_checkin').map((x) => x.recordedAt), ...db.sessions.filter((s) => s.patientId === p.id).map((s) => s.startedAt)].sort().at(-1);
      const since = lastTouch ?? prog.approvedAt ?? prog.createdAt;
      const gap = (nowMs - Date.parse(since)) / 86_400_000;
      if (gap >= r3.threshold) push(r3, `No check-in or session for ${Math.floor(gap)} days`, [lastTouch ? `last contact ${lastTouch.slice(0, 10)}` : `none since plan approval ${since.slice(0, 10)}`]);
    }
    const r4 = on('rom_decrease');
    if (r4) {
      for (const row of trendRows(p.id)) {
        const t = metricTrend(db, p.id, row.protocolId, row.metricId, row.side);
        const l = t.links.at(-1);
        if (l?.comparable && l.change !== null && -l.change >= r4.threshold) {
          const a = t.points[l.from];
          const b = t.points[l.to];
          push(r4, `${row.metricId.replace(/_/g, ' ')}${row.side ? ` (${row.side})` : ''} ${a.value} → ${b.value}`, [`${a.protocol}, ${a.view}, ${a.at.slice(0, 10)}${a.simulated ? ' (simulated)' : ''}`, `${b.protocol}, ${b.view}, ${b.at.slice(0, 10)}${b.simulated ? ' (simulated)' : ''}`], b.at);
        }
      }
    }
    const r5 = on('repeat_invalid');
    if (r5) {
      const la = db.assessments.filter((a) => a.patientId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (la) {
        const bad = capturesFor(db, la.id).filter((c) => c.result.quality.verdict === 'invalid');
        if (bad.length >= r5.threshold) push(r5, `${bad.length} invalid captures in the latest assessment`, bad.map((c) => `${c.protocolId}${c.side ? ` ${c.side}` : ''}: ${c.result.quality.reasons.join('; ')}`), la.createdAt);
      }
    }
    const r6 = on('activity_drop');
    if (r6) {
      const w = activityTrend(db, p.id, now, 2);
      if (w.length === 2 && w[0].medianSteps && w[1].medianSteps !== null) {
        const drop = ((w[0].medianSteps - w[1].medianSteps) / w[0].medianSteps) * 100;
        if (drop >= r6.threshold) push(r6, `Median daily steps ${w[0].medianSteps} → ${w[1].medianSteps} (−${Math.round(drop)}%)`, [`device-imported, ${w[0].daysWithData} and ${w[1].daysWithData} days of data`]);
      }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Changing a threshold clears the review (a new threshold needs its own review). */
export function updateRule(rules: ExceptionRule[], id: ExceptionRule['id'], patch: Partial<Pick<ExceptionRule, 'threshold' | 'enabled'>>): ExceptionRule[] {
  return rules.map((r) => (r.id !== id ? r : { ...r, ...patch, ...(patch.threshold !== undefined && patch.threshold !== r.threshold ? { reviewedBy: undefined, reviewedAt: undefined } : {}) }));
}

export function reviewRule(rules: ExceptionRule[], id: ExceptionRule['id'], by: string, at: string): ExceptionRule[] {
  return rules.map((r) => (r.id === id ? { ...r, reviewedBy: by, reviewedAt: at } : r));
}
