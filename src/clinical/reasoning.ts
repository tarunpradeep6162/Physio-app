import type { SafetyLevel } from '../data/models';
import { factSet, type EvidenceItem } from './evidence';

/**
 * Clinician-review reasoning support (knee). Deterministic, versioned rules — no probabilities,
 * no autonomous diagnosis. For each consideration the engine lists supporting evidence,
 * conflicting evidence, missing information and what would change the assessment, and assigns a
 * state. The clinician accepts / rejects / defers / annotates and records the final impression.
 *
 * DRAFT rule content — requires clinical-lead authorship/approval (Settings → rule approvals).
 */

export const RULE_SET = { id: 'knee-considerations', version: '0.1.0', status: 'DRAFT — not clinically approved' };

export type ConsiderationState = 'supportive' | 'conflicting' | 'insufficient_evidence' | 'additional_examination_required' | 'safety_hold';

interface Pattern {
  /** Fact pattern; `*` matches any suffix, `|` separates alternatives. */
  fact: string;
  label: string;
}

export interface ConsiderationRule {
  id: string;
  title: string;
  summary: string;
  supporting: Pattern[];
  conflicting: Pattern[];
  /** Question/test ids whose absence means information is missing. */
  informative: { key: string; label: string }[];
  requiresExamination: boolean;
  furtherExamination: string[];
  whatWouldChange: string[];
  references?: string[];
}

export const KNEE_RULES: ConsiderationRule[] = [
  {
    id: 'patellofemoral',
    title: 'Patellofemoral pain presentation',
    summary: 'Pain around/behind the kneecap aggravated by loaded knee flexion.',
    supporting: [
      { fact: 'knee_sub:anterior', label: 'Pain at the front of the knee' },
      { fact: 'aggravating:stairs_down|aggravating:stairs_up', label: 'Worse on stairs' },
      { fact: 'aggravating:squatting|aggravating:kneeling', label: 'Worse squatting/kneeling' },
      { fact: 'aggravating:prolonged_sitting', label: 'Worse after prolonged sitting' },
      { fact: 'onset:gradual', label: 'Gradual onset' },
      { fact: 'squat:fppa_medial_*', label: 'Squat: knee toward midline beyond threshold (algorithmic)' },
    ],
    conflicting: [
      { fact: 'swelling:within_2h', label: 'Rapid swelling after injury' },
      { fact: 'locking:true_locking', label: 'True locking' },
      { fact: 'giving_way:frequent', label: 'Frequent giving way' },
    ],
    informative: [
      { key: 'knee_sub', label: 'Exact location within the knee' },
      { key: 'aggravating', label: 'Aggravating activities' },
      { key: 'swelling', label: 'Swelling history' },
      { key: 'cap:knee_squat', label: 'Squat capture' },
    ],
    requiresExamination: false,
    furtherExamination: ['Palpation around the patella', 'Loaded knee-flexion task reproduction (e.g. step-down)', 'Hip and foot contribution screen'],
    whatWouldChange: ['Rapid effusion, locking or giving way would point away from this.', 'Pain localised to the joint line rather than around the patella.', 'Symptoms reproduced by lumbar or hip examination.'],
  },
  {
    id: 'meniscal',
    title: 'Meniscal-related symptoms',
    summary: 'Joint-line pain with mechanical symptoms, often after a twisting load.',
    supporting: [
      { fact: 'mechanism:twisting', label: 'Twisting mechanism' },
      { fact: 'locking:catching|locking:true_locking', label: 'Catching or locking' },
      { fact: 'swelling:after_6h', label: 'Delayed swelling' },
      { fact: 'knee_sub:medial|knee_sub:lateral', label: 'Pain at inner or outer side of knee' },
      { fact: 'aggravating:squatting|aggravating:pivoting', label: 'Worse squatting or pivoting' },
      { fact: 'rom:flexion_limited_*', label: 'Camera flexion below threshold (algorithmic)' },
    ],
    conflicting: [{ fact: 'swelling:none', label: 'No swelling reported' }],
    informative: [
      { key: 'mechanism', label: 'Mechanism of injury' },
      { key: 'locking', label: 'Catching/locking' },
      { key: 'knee_sub', label: 'Exact location within the knee' },
    ],
    requiresExamination: true,
    furtherExamination: ['Joint-line tenderness', 'McMurray / Thessaly tests', 'Effusion assessment'],
    whatWouldChange: ['A cluster of positive clinical tests with joint-line tenderness would increase support.', 'Imaging only if the result would change management.'],
  },
  {
    id: 'ligamentous',
    title: 'Ligamentous instability (e.g. ACL)',
    summary: 'Instability after a pivot/landing injury, often with rapid swelling.',
    supporting: [
      { fact: 'mechanism:twisting|mechanism:landing|mechanism:hyperextension', label: 'Pivot, landing or hyperextension injury' },
      { fact: 'swelling:within_2h', label: 'Swelling within 2 hours' },
      { fact: 'giving_way:occasional|giving_way:frequent', label: 'Giving way' },
      { fact: 'activity:competitive', label: 'Competitive sport' },
    ],
    conflicting: [
      { fact: 'onset:gradual', label: 'Gradual onset without injury' },
      { fact: 'giving_way:no', label: 'No giving way' },
    ],
    informative: [
      { key: 'mechanism', label: 'Mechanism of injury' },
      { key: 'swelling', label: 'Swelling timing' },
      { key: 'giving_way', label: 'Giving way' },
    ],
    requiresExamination: true,
    furtherExamination: ['Lachman test', 'Anterior drawer', 'Pivot shift (if tolerated)'],
    whatWouldChange: ['A negative Lachman in a relaxed patient would reduce support.', 'Clear instability on examination would increase it.'],
  },
  {
    id: 'osteoarthritis',
    title: 'Knee osteoarthritis-related presentation',
    summary: 'Activity-related knee pain in people aged 45 or over, with little or brief morning stiffness.',
    supporting: [
      { fact: 'age_ge_45', label: 'Age 45 or over' },
      { fact: 'time_of_day:during_activity|time_of_day:after_activity', label: 'Activity-related pain' },
      { fact: 'morning_stiffness:none|morning_stiffness:lt30', label: 'No morning stiffness, or under 30 minutes' },
      { fact: 'onset:gradual', label: 'Gradual onset' },
      { fact: 'duration:gt3m', label: 'More than 3 months' },
      { fact: 'rom:flexion_limited_*', label: 'Camera flexion below threshold (algorithmic)' },
    ],
    conflicting: [
      { fact: 'morning_stiffness:gt30', label: 'Morning stiffness over 30 minutes' },
      { fact: 'swelling:within_2h', label: 'Acute traumatic swelling' },
      { fact: 'age_lt_45', label: 'Under 45' },
    ],
    informative: [
      { key: 'morning_stiffness', label: 'Morning stiffness duration' },
      { key: 'time_of_day', label: 'Relationship to activity' },
      { key: 'age', label: 'Date of birth' },
    ],
    requiresExamination: false,
    furtherExamination: ['Examination for crepitus, bony enlargement and effusion', 'Function and strength assessment'],
    whatWouldChange: ['Prolonged morning stiffness or multiple swollen joints would point toward an inflammatory condition.'],
    references: ['NICE guideline NG226 (2022): Osteoarthritis in over 16s — clinical diagnosis criteria.'],
  },
  {
    id: 'post_operative',
    title: 'Post-operative range-of-motion deficit',
    summary: 'Reduced knee range after surgery.',
    supporting: [
      { fact: 'onset:after_surgery', label: 'Onset after surgery' },
      { fact: 'rom:flexion_limited_*', label: 'Camera flexion below threshold (algorithmic)' },
      { fact: 'rom:extension_deficit_*', label: 'Knee not reaching straight (algorithmic)' },
      { fact: 'rom:flexion_asymmetry', label: 'Left/right flexion difference (algorithmic)' },
    ],
    conflicting: [],
    informative: [
      { key: 'surgery_type', label: 'Type of surgery' },
      { key: 'surgery_date', label: 'Date of surgery' },
      { key: 'cap:knee_supported_flexion', label: 'Knee flexion capture, both sides' },
    ],
    requiresExamination: false,
    furtherExamination: ['Wound and effusion check', 'Surgeon-specified precautions', 'Passive range and end-feel'],
    whatWouldChange: ['Surgical protocol restrictions override standard range targets.'],
  },
  {
    id: 'referred',
    title: 'Referred symptoms (lumbar spine or hip)',
    summary: 'Knee-region symptoms originating elsewhere.',
    supporting: [
      { fact: 'symptom:numbness|symptom:tingling', label: 'Numbness or tingling' },
      { fact: 'radiation:present', label: 'Symptoms spread along a path' },
      { fact: 'region_part:lower_back_center|region_part:buttock|region_part:groin|region_part:hip_lateral|region_part:thigh_back|region_part:thigh_front', label: 'Back, buttock, hip or thigh symptoms' },
    ],
    conflicting: [
      { fact: 'swelling:within_2h|swelling:after_6h', label: 'Knee swelling' },
      { fact: 'locking:true_locking', label: 'True locking' },
    ],
    informative: [{ key: 'symptom_map', label: 'Symptom map with symptom types' }],
    requiresExamination: true,
    furtherExamination: ['Lumbar spine screen', 'Hip examination', 'Neurological examination'],
    whatWouldChange: ['Reproduction of knee symptoms from lumbar or hip movement would increase support.'],
  },
  {
    id: 'inflammatory',
    title: 'Inflammatory or systemic joint condition — consider medical review',
    summary: 'Features suggesting a non-mechanical cause.',
    supporting: [
      { fact: 'morning_stiffness:gt30', label: 'Morning stiffness over 30 minutes' },
      { fact: 'conditions:inflammatory_arthritis', label: 'Known inflammatory arthritis' },
      { fact: 'swelling:comes_goes', label: 'Recurrent swelling' },
      { fact: 'night:wakes_often', label: 'Night pain waking most nights' },
    ],
    conflicting: [{ fact: 'mechanism:*', label: 'Clear injury mechanism' }],
    informative: [{ key: 'morning_stiffness', label: 'Morning stiffness duration' }],
    requiresExamination: true,
    furtherExamination: ['Other joints', 'Medical review and investigations as indicated'],
    whatWouldChange: ['Multiple joint involvement or systemic features would increase support.'],
  },
];

export interface EvaluatedConsideration {
  rule: ConsiderationRule;
  state: ConsiderationState;
  supporting: { label: string; evidence: EvidenceItem[] }[];
  conflicting: { label: string; evidence: EvidenceItem[] }[];
  missing: string[];
}

function matchFacts(pattern: string, facts: Map<string, EvidenceItem[]>): EvidenceItem[] {
  const alts = pattern.split('|');
  const hits: EvidenceItem[] = [];
  for (const [fact, items] of facts) {
    if (alts.some((p) => (p.endsWith('*') ? fact.startsWith(p.slice(0, -1)) : fact === p))) hits.push(...items);
  }
  return [...new Set(hits)];
}

function isKnown(key: string, evidence: EvidenceItem[]): boolean {
  if (key === 'knee_sub') return evidence.some((e) => e.facts.some((f) => f.startsWith('knee_sub:')));
  if (key === 'age') return evidence.some((e) => e.id === 'profile:age');
  if (key === 'symptom_map') return evidence.some((e) => e.id.startsWith('map:'));
  if (key.startsWith('cap:')) {
    const proto = key.slice(4);
    return evidence.some((e) => e.source.kind === 'capture_metric' && e.source.protocol.startsWith(proto) && e.validity === 'valid');
  }
  return evidence.some((e) => e.id === `ans:${key}`);
}

export function evaluate(evidence: EvidenceItem[], safety: SafetyLevel | undefined): EvaluatedConsideration[] {
  const facts = factSet(evidence.filter((e) => e.validity !== 'invalid'));
  return KNEE_RULES.map((rule) => {
    const supporting = rule.supporting.map((p) => ({ label: p.label, evidence: matchFacts(p.fact, facts) })).filter((x) => x.evidence.length);
    const conflicting = rule.conflicting.map((p) => ({ label: p.label, evidence: matchFacts(p.fact, facts) })).filter((x) => x.evidence.length);
    const missing = rule.informative.filter((i) => !isKnown(i.key, evidence)).map((i) => i.label);
    let state: ConsiderationState;
    if (safety && safety !== 'clear') state = 'safety_hold';
    else if (supporting.length === 0) state = 'insufficient_evidence';
    else if (conflicting.length > supporting.length) state = 'conflicting';
    else if (rule.requiresExamination || conflicting.length > 0) state = 'additional_examination_required';
    else if (supporting.length >= 2) state = 'supportive';
    else state = 'insufficient_evidence';
    return { rule, state, supporting, conflicting, missing };
  }).sort((a, b) => b.supporting.length - b.conflicting.length - (a.supporting.length - a.conflicting.length));
}

export const STATE_LABEL: Record<ConsiderationState, string> = {
  supportive: 'Supportive evidence',
  conflicting: 'Conflicting evidence',
  insufficient_evidence: 'Insufficient evidence',
  additional_examination_required: 'Additional examination required',
  safety_hold: 'Safety pathway active — not evaluated',
};
