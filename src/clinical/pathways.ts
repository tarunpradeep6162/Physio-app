import type { Assessment } from '../data/models';
import { DEFAULT_PLANS } from '../engine/protocols/registry';
import type { Side } from '../engine/types';
import { HISTORY_QUESTIONNAIRE, SHOULDER_HISTORY_QUESTIONNAIRE, type Questionnaire } from './intake';
import { SAFETY_QUESTIONNAIRE, SHOULDER_SAFETY_QUESTIONNAIRE, type SafetyQuestionnaire } from './safety';

/**
 * Assessment pathway registry. Each region supplies its own versioned history and safety
 * questionnaires, default test plan, finer symptom locations, report rows and scope limits. The
 * patient flow, clinician workspace and report are driven from this table, so a new region is
 * added here rather than by copying screens.
 */

export type PathwayRegion = 'knee' | 'shoulder';

export interface PathwayMetricRow {
  protocolId: string;
  metricId: string;
  label: string;
}

export interface Pathway {
  region: PathwayRegion;
  label: string;
  history: Questionnaire;
  safety: SafetyQuestionnaire;
  defaultPlan: { protocolId: string; side: Side | null }[];
  /** Finer location chips shown for a symptom region of this pathway. */
  subLocations: { id: string; label: string }[];
  /** Body-map region ids that belong to this pathway. */
  isRegion: (regionId: string) => boolean;
  /** Questions repeated at reassessment (the rest are carried from baseline). */
  reassessQuestions: Set<string>;
  /** Per-side rows compared left vs right, and against baseline in the report. */
  sidedRows: PathwayMetricRow[];
  /** Metric trended across assessments. */
  trend: PathwayMetricRow;
  /** Left/right symmetry rows in the report (full labels). */
  symmetryRows: PathwayMetricRow[];
  /** Protocols reported in the functional-tests section. */
  functionalProtocols: string[];
  /** Method note printed under the range-of-motion table. */
  romNote: string;
  /** Whether draft differential-consideration rules exist for this region. */
  hasConsiderationRules: boolean;
  reportTemplate: string;
  /** What the camera cannot establish for this region (shown to clinicians and in the report). */
  scopeLimits: string[];
}

const KNEE: Pathway = {
  region: 'knee',
  label: 'Knee',
  history: HISTORY_QUESTIONNAIRE,
  safety: SAFETY_QUESTIONNAIRE,
  defaultPlan: DEFAULT_PLANS.knee!,
  subLocations: [
    { id: 'anterior', label: 'Front / kneecap' },
    { id: 'medial', label: 'Inner side' },
    { id: 'lateral', label: 'Outer side' },
    { id: 'posterior', label: 'Back of knee' },
    { id: 'whole', label: 'Whole knee' },
  ],
  isRegion: (id) => id.startsWith('knee'),
  reassessQuestions: new Set(['nprs_now', 'nprs_worst', 'nprs_best', 'pattern', 'night', 'aggravating', 'func_stairs', 'func_squat', 'func_walk', 'func_chair', 'swelling', 'locking', 'giving_way']),
  sidedRows: [
    { protocolId: 'knee_supported_flexion', metricId: 'knee_flexion_peak', label: 'Flexion (peak)' },
    { protocolId: 'knee_supported_flexion', metricId: 'knee_extension_position', label: 'Most-extended position' },
  ],
  trend: { protocolId: 'knee_supported_flexion', metricId: 'knee_flexion_peak', label: 'knee flexion' },
  symmetryRows: [{ protocolId: 'knee_supported_flexion', metricId: 'knee_flexion_peak', label: 'Knee flexion (peak)' }],
  functionalProtocols: ['knee_sit_to_stand', 'knee_squat'],
  romNote: 'Camera-estimated, 2D lateral view, active movement. Not interchangeable with goniometry until validated.',
  hasConsiderationRules: true,
  reportTemplate: 'pv-knee-report-1.0.0',
  scopeLimits: [
    'The camera estimates 2D knee angles, timing and alignment only. It cannot identify which structure causes pain.',
    'Hyperextension, passive range, ligament laxity, effusion and strength require clinical examination.',
  ],
};

const SHOULDER: Pathway = {
  region: 'shoulder',
  label: 'Shoulder',
  history: SHOULDER_HISTORY_QUESTIONNAIRE,
  safety: SHOULDER_SAFETY_QUESTIONNAIRE,
  defaultPlan: DEFAULT_PLANS.shoulder!,
  subLocations: [
    { id: 'front', label: 'Front of shoulder' },
    { id: 'top', label: 'Top of shoulder' },
    { id: 'outer_arm', label: 'Outer upper arm' },
    { id: 'back', label: 'Back / shoulder blade' },
    { id: 'whole', label: 'Whole shoulder' },
  ],
  isRegion: (id) => id.startsWith('shoulder') || id.startsWith('upper_arm'),
  reassessQuestions: new Set(['nprs_now', 'nprs_worst', 'nprs_best', 'pattern', 'night', 'aggravating', 'instability', 'arm_symptoms', 'func_overhead', 'func_behind_back', 'func_carry', 'func_dressing']),
  sidedRows: [
    { protocolId: 'shoulder_flexion_active', metricId: 'shoulder_flexion_peak', label: 'Flexion (peak)' },
    { protocolId: 'shoulder_flexion_active', metricId: 'shoulder_flexion_trunk_lean', label: 'Trunk angle at flexion peak' },
    { protocolId: 'shoulder_abduction_active', metricId: 'shoulder_abduction_peak', label: 'Abduction (peak)' },
    { protocolId: 'shoulder_abduction_active', metricId: 'shoulder_abduction_trunk_lean', label: 'Trunk side-lean at abduction peak' },
  ],
  trend: { protocolId: 'shoulder_flexion_active', metricId: 'shoulder_flexion_peak', label: 'shoulder flexion' },
  symmetryRows: [
    { protocolId: 'shoulder_flexion_active', metricId: 'shoulder_flexion_peak', label: 'Shoulder flexion (peak)' },
    { protocolId: 'shoulder_abduction_active', metricId: 'shoulder_abduction_peak', label: 'Shoulder abduction (peak)' },
  ],
  functionalProtocols: [],
  romNote: 'Camera-estimated, active movement: flexion from a 2D side view, abduction from a 2D front view. Trunk angles are compensation checks, not joint range. Rotation is not measured. Not interchangeable with goniometry until validated.',
  // No draft differential rules: the clinician records the impression. Nothing is inferred.
  hasConsiderationRules: false,
  reportTemplate: 'dl-shoulder-report-1.0.0',
  scopeLimits: [
    'The camera estimates 2D arm elevation forward (side view) and sideways (front view) only. It cannot identify which structure causes pain.',
    'Internal and external rotation, hand-behind-back, scapular movement, passive range, painful arc, instability and strength are not measured: they need clinical examination.',
    'Neck-related arm symptoms and the red-flag screen rely on the patient’s answers and the clinician, not the camera.',
  ],
};

export const PATHWAYS: Record<PathwayRegion, Pathway> = { knee: KNEE, shoulder: SHOULDER };

/** The pathway an assessment belongs to (legacy assessments without a region are knee). */
export function pathwayFor(a: Pick<Assessment, 'region'> | undefined | null): Pathway {
  return a?.region === 'shoulder' ? SHOULDER : KNEE;
}

export const isPathwayRegion = (r: unknown): r is PathwayRegion => r === 'knee' || r === 'shoulder';
