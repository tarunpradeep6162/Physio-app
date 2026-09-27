import type { CaptureSession, DB, ID, ReviewStatus } from '../data/models';
import { age } from '../data/queries';
import { getProtocol } from '../engine/protocols/registry';
import { parseRegion, regionLabel } from '../features/bodymap/regions';
import { currentAnswers, formatAnswer } from './intake';
import { pathwayFor } from './pathways';
import { levelFromResponses } from './safety';

/**
 * Evidence graph: every finding the reasoning layer may use, with a link to where it came from,
 * the method/version, validity and limits. Categories are never merged.
 *
 * `facts` are the machine-readable tokens reasoning rules match against (e.g. "onset:sudden").
 * Invalid captures appear as evidence (so the clinician sees they happened) but carry no facts.
 */

export type EvidenceCategory = 'patient_reported' | 'camera_estimated' | 'algorithmic' | 'clinician';

export interface EvidenceItem {
  id: string;
  category: EvidenceCategory;
  label: string;
  value: string;
  facts: string[];
  source:
    | { kind: 'intake_answer'; answerId: ID; questionId: string; questionText: string; answeredAt: string; questionnaire: string }
    | { kind: 'symptom_map'; regionRowId: ID }
    | { kind: 'profile'; field: string }
    | { kind: 'capture_metric'; captureId: ID; metricId: string; protocol: string }
    | { kind: 'scan_metric'; scanId: ID; measurementId: ID; view: string }
    | { kind: 'rule'; rule: string; basedOn: string[] }
    | { kind: 'clinician_measure'; measurementId: ID }
    | { kind: 'safety'; responseIds: ID[] };
  method?: string;
  version?: string;
  validity: 'valid' | 'invalid' | 'n/a';
  validityNote?: string;
  limitations: string[];
}

/** Parameters of the algorithmic observation rules (versioned with the reasoning rule set). */
export const OBSERVATION_RULES_VERSION = 'knee-observations-1.0.0';
const EXTENSION_DEFICIT_DEG = 5;

/**
 * Clinician review of a capture metric (from its linked camera-estimate measurement row), if any.
 * A rejected or repeat-requested metric is never used as a finding, in evidence or in the report.
 */
export function metricReview(db: DB, captureId: ID, metricId: string): ReviewStatus | null {
  const rows = db.measurements.filter((m) => m.captureId === captureId && m.metricId === metricId && m.category === 'camera_estimate');
  return rows.length ? rows[rows.length - 1].reviewStatus : null;
}

export const reviewBlocks = (r: ReviewStatus | null) => r === 'rejected' || r === 'repeat_requested';

export function capturesFor(db: DB, assessmentId: ID): CaptureSession[] {
  // Latest capture per protocol+side (earlier attempts stay in history).
  const rows = db.captures.filter((c) => c.assessmentId === assessmentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const m = new Map<string, CaptureSession>();
  for (const c of rows) m.set(`${c.protocolId}:${c.side ?? 'both'}`, c);
  return [...m.values()];
}

export function buildEvidence(db: DB, assessmentId: ID): EvidenceItem[] {
  const a = db.assessments.find((x) => x.id === assessmentId);
  if (!a) return [];
  const patient = db.patients.find((p) => p.id === a.patientId);
  const out: EvidenceItem[] = [];
  const pathway = pathwayFor(a);

  // --- Patient-reported: symptom map --------------------------------------------------------
  const regions = db.painRegions.filter((r) => r.assessmentId === assessmentId);
  for (const r of regions) {
    const { part, side } = parseRegion(r.regionId);
    const facts = [`region:${r.regionId}`, `region_part:${part}`, ...(r.symptomTypes ?? []).map((s) => `symptom:${s}`), ...(r.subLocations ?? []).map((s) => `${pathway.region}_sub:${s}`)];
    out.push({
      id: `map:${r.id}`,
      category: 'patient_reported',
      label: `Symptom location — ${regionLabel(r.regionId)}`,
      value: [(r.symptomTypes ?? ['pain']).join(', '), r.subLocations?.length ? `(${r.subLocations.join(', ')})` : ''].join(' ').trim(),
      facts: side ? facts : facts,
      source: { kind: 'symptom_map', regionRowId: r.id },
      validity: 'n/a',
      limitations: ['Patient-drawn location; not examined.'],
    });
  }
  const paths = db.radiationPaths.filter((p) => p.assessmentId === assessmentId);
  if (paths.length)
    out.push({
      id: `map:radiation`,
      category: 'patient_reported',
      label: 'Symptom radiation path drawn',
      value: paths.map((p) => `${p.symptomType} (${p.view} view)`).join(', '),
      facts: ['radiation:present', ...paths.map((p) => `radiation:${p.symptomType}`)],
      source: { kind: 'symptom_map', regionRowId: paths[0].id },
      validity: 'n/a',
      limitations: ['Freehand drawing; approximate.'],
    });

  // --- Patient-reported: history answers ----------------------------------------------------
  const own = db.intakeAnswers.filter((r) => r.assessmentId === assessmentId && !r.supersededBy);
  // A reassessment re-asks only some questions; the rest are carried from the baseline, labelled.
  const baseRows = a.baselineAssessmentId ? db.intakeAnswers.filter((r) => r.assessmentId === a.baselineAssessmentId && !r.supersededBy) : [];
  const ownAnswers = currentAnswers(own);
  const answers = { ...currentAnswers(baseRows), ...ownAnswers };
  for (const q of pathway.history.questions) {
    const v = answers[q.id];
    if (v === undefined || v === null || v === '') continue;
    const fromBaseline = ownAnswers[q.id] === undefined;
    const rows = fromBaseline ? baseRows : own;
    const row = rows.filter((r) => r.questionId === q.id).sort((x, y) => y.answeredAt.localeCompare(x.answeredAt))[0];
    const facts = Array.isArray(v) ? v.map((x) => `${q.id}:${x}`) : [`${q.id}:${v}`];
    out.push({
      id: `ans:${q.id}`,
      category: 'patient_reported',
      label: fromBaseline ? `${q.text} (from baseline)` : q.text,
      value: formatAnswer(q.id, v, pathway.history),
      facts,
      source: { kind: 'intake_answer', answerId: row.id, questionId: q.id, questionText: row.questionText, answeredAt: row.answeredAt, questionnaire: `${row.questionnaireId}@${row.questionnaireVersion}` },
      validity: 'n/a',
      limitations: ['Patient-reported; recorded verbatim.'],
    });
  }
  const yrs = age(patient?.dob);
  if (yrs !== null)
    out.push({ id: 'profile:age', category: 'patient_reported', label: 'Age (from date of birth)', value: `${yrs} years`, facts: yrs >= 45 ? ['age_ge_45'] : ['age_lt_45'], source: { kind: 'profile', field: 'dob' }, validity: 'n/a', limitations: [] });

  // --- Safety --------------------------------------------------------------------------------
  const safety = db.safetyResponses.filter((r) => r.assessmentId === assessmentId);
  if (safety.length) {
    const level = levelFromResponses(safety);
    const yes = safety.filter((r) => r.answer);
    out.push({
      id: 'safety',
      category: 'patient_reported',
      label: `Safety screen (${pathway.safety.id}@${pathway.safety.version})`,
      value: level === 'clear' ? 'No red-flag answers' : `${level.replace('_', ' ')} — ${yes.map((r) => r.questionId).join(', ')}`,
      facts: [`safety:${level}`],
      source: { kind: 'safety', responseIds: safety.map((r) => r.id) },
      validity: 'n/a',
      limitations: ['Screening questions only; not an examination.'],
    });
  }

  // --- Camera-estimated + algorithmic ---------------------------------------------------------
  const thr = db.settings.thresholds;
  const caps = capturesFor(db, assessmentId);
  const flexPeak: Partial<Record<'left' | 'right', { v: number; id: string }>> = {};
  for (const c of caps) {
    const def = getProtocol(c.protocolId, c.protocolVersion);
    const simulated = c.provenance.source === 'simulated_demo';
    for (const m of c.result.metrics) {
      const id = `cap:${c.id}:${m.id}`;
      const review = metricReview(db, c.id, m.id);
      const valid = m.validity === 'valid' && c.result.quality.verdict === 'valid' && !reviewBlocks(review);
      const side = m.side ?? c.side;
      out.push({
        id,
        category: 'camera_estimated',
        label: `${m.label}${side && !m.side ? ` — ${side}` : ''}`,
        value: valid && m.value !== null ? `${m.value}${m.unit === 'deg' ? '°' : m.unit === 's' ? ' s' : m.unit === 'pct_leg' ? '% leg length' : ''}` : reviewBlocks(review) ? `Not used — ${review === 'rejected' ? 'rejected' : 'repeat requested'} by clinician` : `Not reported — ${m.reason ?? c.result.quality.reasons.join('; ')}`,
        facts: [],
        source: { kind: 'capture_metric', captureId: c.id, metricId: m.id, protocol: `${def.id}@${def.version}` },
        method: m.method,
        version: `${c.result.algorithmVersion} · ${c.provenance.poseModel ?? ''} ${c.provenance.poseModelVersion ?? ''}`.trim(),
        validity: valid ? 'valid' : 'invalid',
        validityNote: `Coverage ${Math.round(c.result.quality.coverage * 100)}%, ${c.result.quality.validCycles} valid reps · clinician review: ${review ?? 'not reviewed'}${simulated ? ' · SIMULATED demo data' : ''}`,
        limitations: def.limitations,
      });
      if (!valid || m.value === null) continue;
      if (m.id === 'knee_flexion_peak' && c.side) {
        flexPeak[c.side] = { v: m.value, id };
        if (m.value < thr.knee_flexion_limited)
          out.push({
            id: `obs:flex_limited:${c.side}`,
            category: 'algorithmic',
            label: `Knee flexion below configured threshold — ${c.side}`,
            value: `${m.value}° < ${thr.knee_flexion_limited}°`,
            facts: [`rom:flexion_limited_${c.side}`],
            source: { kind: 'rule', rule: `${OBSERVATION_RULES_VERSION}:knee_flexion_limited`, basedOn: [id] },
            validity: 'valid',
            limitations: ['Threshold is clinician-configured; not a population norm.'],
          });
      }
      if (m.id === 'knee_extension_position' && c.side && m.value > EXTENSION_DEFICIT_DEG)
        out.push({
          id: `obs:ext_deficit:${c.side}`,
          category: 'algorithmic',
          label: `Knee did not reach straight — ${c.side}`,
          value: `${m.value}° from straight (> ${EXTENSION_DEFICIT_DEG}°)`,
          facts: [`rom:extension_deficit_${c.side}`],
          source: { kind: 'rule', rule: `${OBSERVATION_RULES_VERSION}:extension_deficit`, basedOn: [id] },
          validity: 'valid',
          limitations: ['2D estimate; confirm clinically.'],
        });
      if (m.id.startsWith('squat_fppa_') && m.side && m.value > thr.knee_frontal)
        out.push({
          id: `obs:fppa:${m.side}`,
          category: 'algorithmic',
          label: `Squat knee toward midline beyond threshold — ${m.side}`,
          value: `FPPA ${m.value}° > ${thr.knee_frontal}°`,
          facts: [`squat:fppa_medial_${m.side}`],
          source: { kind: 'rule', rule: `${OBSERVATION_RULES_VERSION}:fppa_medial`, basedOn: [id] },
          validity: 'valid',
          limitations: ['2D proxy; descriptive only.'],
        });
    }
  }
  if (flexPeak.left && flexPeak.right) {
    const diff = Math.abs(flexPeak.left.v - flexPeak.right.v);
    if (diff > thr.asymmetry) {
      const lower = flexPeak.left.v < flexPeak.right.v ? 'left' : 'right';
      out.push({
        id: 'obs:flex_asymmetry',
        category: 'algorithmic',
        label: 'Left/right knee flexion difference beyond threshold',
        value: `${Math.round(diff * 10) / 10}° (lower on ${lower})`,
        facts: ['rom:flexion_asymmetry', `rom:flexion_lower_${lower}`],
        source: { kind: 'rule', rule: `${OBSERVATION_RULES_VERSION}:asymmetry`, basedOn: [flexPeak.left.id, flexPeak.right.id] },
        validity: 'valid',
        limitations: ['A left/right difference is descriptive and is not, by itself, evidence of pathology.'],
      });
    }
  }

  // Static camera scan: descriptive estimates and threshold observations remain separate.
  // A camera observation does not establish the cause of a symptom or a diagnosis.
  const latestScanByView = new Map<string, ID>();
  for (const scan of db.scans.filter((s) => s.assessmentId === assessmentId && s.kind === 'static_posture').sort((x, y) => x.createdAt.localeCompare(y.createdAt))) latestScanByView.set(scan.view, scan.id);
  const scanMeasurements = db.measurements.filter((m) => m.assessmentId === assessmentId && m.type.startsWith('posture.') && m.scanId);
  const scanIds = new Set(latestScanByView.values());
  for (const m of scanMeasurements) {
    if (!scanIds.has(m.scanId!)) continue;
    const id = `scan:${m.id}`;
    const valid = m.validity !== 'invalid' && m.confidence >= 0.7;
    out.push({
      id,
      category: 'camera_estimated',
      label: `${m.type.slice('posture.'.length).replace(/_/g, ' ')} — ${m.provenance.view ?? 'unknown view'}`,
      value: valid ? `${m.value}${m.unit === 'deg' ? '°' : '% body height'}${m.direction ? ` (${m.direction.replace(/_/g, ' ')})` : ''}` : 'Not reported — capture quality insufficient',
      facts: [],
      source: { kind: 'scan_metric', scanId: m.scanId!, measurementId: m.id, view: m.provenance.view ?? 'unknown' },
      method: '2D pose landmarks; median over a stationary capture',
      version: `${m.provenance.algorithmVersion} · ${m.provenance.poseModel ?? ''} ${m.provenance.poseModelVersion ?? ''}`.trim(),
      validity: valid ? 'valid' : 'invalid',
      validityNote: `Confidence ${m.confidence.toFixed(2)}${m.sd === undefined ? '' : ` · capture SD ${m.sd.toFixed(2)}`}; clinician review ${m.reviewStatus}`,
      limitations: ['Camera-estimated alignment, affected by positioning and occlusion. Descriptive only; no diagnosis or universal normal range.'],
    });
    if (!valid || m.reviewStatus === 'rejected') continue;
    for (const o of db.observations.filter((x) => x.measurementId === m.id)) {
      out.push({
        id: `scan-observation:${o.id}`,
        category: 'algorithmic',
        label: `${m.type.slice('posture.'.length).replace(/_/g, ' ')} crossed configured threshold`,
        value: `${m.value}° > ${o.threshold}° (configured threshold; clinician review ${o.status})`,
        facts: [],
        source: { kind: 'rule', rule: `posture-observation:${o.rule}`, basedOn: [id] },
        validity: 'valid',
        limitations: ['A threshold crossing is an observation, not evidence of a specific condition.'],
      });
    }
  }

  // --- Clinician-entered ------------------------------------------------------------------------
  for (const m of db.measurements.filter((x) => x.patientId === a.patientId && x.category === 'clinician_measured' && (x.assessmentId === assessmentId || !x.assessmentId))) {
    out.push({
      id: `clin:${m.id}`,
      category: 'clinician',
      label: `${m.type.replace(/_/g, ' ')}${m.side ? ` — ${m.side}` : ''} (clinician-measured)`,
      value: `${m.value}°`,
      facts: [],
      source: { kind: 'clinician_measure', measurementId: m.id },
      method: m.provenance.source,
      validity: 'valid',
      limitations: [],
    });
  }
  return out;
}

export function factSet(items: EvidenceItem[]): Map<string, EvidenceItem[]> {
  const m = new Map<string, EvidenceItem[]>();
  for (const it of items) for (const f of it.facts) m.set(f, [...(m.get(f) ?? []), it]);
  return m;
}
