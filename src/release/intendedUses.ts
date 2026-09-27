import type { DB } from '../data/models';
import { PROTOCOLS } from '../engine/protocols/registry';
import { latestItems } from '../content/contentStore';
import { DEFAULT_EXCEPTION_RULES } from '../clinical/trends';

/**
 * Evidence, validation and controlled release (Phase 20).
 *
 * Real-patient use is DISABLED in this build. It can only be enabled by a code change that follows
 * the clinical lead's explicit, recorded approval — there is deliberately no in-app button that
 * could record that approval (a demo or test account must never be able to).
 */
export const REAL_PATIENT_USE_ENABLED = false as const;

export type EvidenceLevel = 'synthetic_only' | 'lab_emulated' | 'device_benchmarked' | 'reference_agreement' | 'validated';

export interface IntendedUse {
  protocolId: string;
  /** Locked protocol version the claim refers to. */
  protocolVersion: string;
  claim: string;
  notFor: string[];
  /** Proposed population — for the clinical lead to confirm. */
  population: string;
  evidence: EvidenceLevel;
  studiesRequired: ('repeatability' | 'inter_device' | 'reference_agreement' | 'usability')[];
  reference: string;
  status: 'not_validated' | 'validation_in_progress' | 'validated';
}

const COMMON_NOT_FOR = ['Diagnosis or identifying the structure causing symptoms', 'Measuring strength, force, fatigue, neurological status or fall risk', 'Comparison with population norms', 'Use without clinician review'];
const LAB = new Set(['knee_supported_flexion', 'knee_sit_to_stand', 'knee_squat', 'shoulder_flexion_active', 'shoulder_abduction_active']);

const REFERENCE: Record<string, string> = {
  knee_supported_flexion: 'Universal goniometer (blinded examiner)',
  knee_sit_to_stand: 'Stopwatch / frame-annotated video',
  knee_squat: 'Frame-annotated video (FPPA)',
  shoulder_flexion_active: 'Goniometer or digital inclinometer',
  shoulder_abduction_active: 'Goniometer or digital inclinometer',
  hip_flexion_standing: 'Goniometer',
  hip_abduction_standing: 'Goniometer',
  ankle_knee_to_wall: 'Digital inclinometer on the tibia (weight-bearing lunge)',
  heel_raise_double: 'Frame-annotated video (repetition count)',
  trunk_forward_bend: 'Inclinometer at T1 / sacrum (as a combined trunk measure)',
  trunk_side_bend: 'Inclinometer / frame-annotated video',
  neck_flexion_extension: 'CROM device or inclinometer (change from neutral)',
  single_leg_stance: 'Stopwatch (trained examiner)',
  march_in_place: 'Frame-annotated video (step count and timing)',
};

export const INTENDED_USES: IntendedUse[] = Object.values(PROTOCOLS).map((p) => ({
  protocolId: p.id,
  protocolVersion: p.version,
  claim: `${p.purpose} Presented to a clinician as a camera estimate with quality and provenance, alongside their own examination.`,
  notFor: [...COMMON_NOT_FOR, ...p.limitations.filter((l) => /not measured|cannot|NOT/i.test(l)).slice(0, 2)],
  population: `Adults (18+) able to perform the ${p.shortTitle.toLowerCase()} safely at home, attending physiotherapy — to be confirmed by the clinical lead`,
  evidence: LAB.has(p.id) ? 'lab_emulated' : 'synthetic_only',
  studiesRequired: ['repeatability', 'inter_device', 'reference_agreement', 'usability'],
  reference: REFERENCE[p.id] ?? 'To be defined',
  status: 'not_validated',
}));

export type GateStatus = 'pass' | 'pending' | 'fail';
export interface GateItem {
  id: string;
  label: string;
  status: GateStatus;
  detail: string;
  owner: string;
}

/** Go/no-go checklist. Every item must pass before real-patient release; the build flag must also change. */
export function releaseGate(db: DB): GateItem[] {
  const s = db.settings;
  const rules = s.exceptionRules ?? DEFAULT_EXCEPTION_RULES;
  const content = latestItems(db);
  const approvals = Object.keys(s.ruleApprovals ?? {});
  const validated = INTENDED_USES.filter((u) => u.status === 'validated').length;
  return [
    { id: 'clinical_approval', label: 'Clinical lead approval of the release (Dheepika)', status: 'pending', detail: 'On hold by instruction. Recorded only by the clinical lead, outside the app.', owner: 'Dheepika' },
    { id: 'intended_uses', label: 'Intended uses validated', status: validated === INTENDED_USES.length ? 'pass' : 'pending', detail: `${validated} of ${INTENDED_USES.length} validated; evidence so far is synthetic or lab-emulated only.`, owner: 'Clinical lead + study team' },
    { id: 'release_thresholds', label: 'Validation acceptance thresholds locked before the final analysis', status: s.releaseThresholds ? 'pass' : 'pending', detail: s.releaseThresholds ? `Locked ${s.releaseThresholds.lockedAt}` : 'Not set (Validation study screen).', owner: 'Clinical lead + statistician' },
    { id: 'rule_sets', label: 'Clinical rule sets reviewed (safety, reasoning, protocols)', status: 'pending', detail: approvals.length ? `${approvals.length} rule set(s) recorded in Settings; the full list in the approval packet still needs review.` : 'None reviewed.', owner: 'Clinical lead' },
    { id: 'exception_rules', label: 'Exception-queue thresholds reviewed', status: rules.every((r) => !r.enabled || r.reviewedBy) ? 'pass' : 'pending', detail: `${rules.filter((r) => r.enabled && !r.reviewedBy).length} enabled rule(s) unreviewed.`, owner: 'Clinical lead' },
    { id: 'content', label: 'Exercise content reviewed and published', status: 'pending', detail: `${content.filter((c) => c.review.status === 'approved').length} of ${content.length} items approved; licensed media not yet added.`, owner: 'Clinical lead' },
    { id: 'devices', label: 'Real-phone benchmark on the target devices', status: 'pending', detail: 'No real-device results (docs/tracking/PHONE_RUN.md).', owner: 'Engineering + clinic' },
    { id: 'occlusion', label: 'Occlusion release blockers resolved (elbow self-occlusion, object occlusion)', status: 'fail', detail: 'Unsafe values remain in the lab for these scenarios; the coverage-check decision is pending with the owner (docs/tracking/RESULTS.md).', owner: 'Owner + engineering' },
    { id: 'server', label: 'Secure server deployment (auth, RLS, backups, audit)', status: 'pending', detail: 'Schema and RLS are tested locally (migrations 001–004); nothing is deployed. The browser-local store is unsuitable for real patients.', owner: 'Owner (hosting, IdP, DPA)' },
    { id: 'privacy', label: 'Privacy impact assessment and data-processing agreements', status: 'pending', detail: 'For the launch jurisdiction(s); see the approval packet.', owner: 'Owner + privacy adviser' },
    { id: 'regulatory', label: 'Regulatory classification reviewed for the launch jurisdiction(s)', status: 'pending', detail: 'Software used in clinical assessment may be regulated as a medical device; needs a qualified adviser.', owner: 'Owner + regulatory adviser' },
    { id: 'tamil', label: 'Tamil clinical translation reviewed', status: 'pending', detail: '152 of 545 UI strings drafted, none reviewed; questionnaires English-only.', owner: 'Qualified translator + clinician' },
    { id: 'usability', label: 'Usability and accessibility with real patients and screen readers', status: 'pending', detail: 'Automated axe checks pass; no real-user sessions yet.', owner: 'Clinic' },
    { id: 'incident_process', label: 'Incident process agreed and staffed', status: 'pending', detail: 'Proposed in docs/INCIDENT_PROCESS.md.', owner: 'Owner + clinical lead' },
    { id: 'build_flag', label: 'Real-patient use enabled in the build', status: REAL_PATIENT_USE_ENABLED ? 'pass' : 'pending', detail: 'Disabled; enabled only by a reviewed code change after all items above pass.', owner: 'Engineering (after approval)' },
  ];
}

export const releaseAllowed = (db: DB) => REAL_PATIENT_USE_ENABLED && releaseGate(db).every((g) => g.status === 'pass');
