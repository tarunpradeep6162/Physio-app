import type { Assessment } from '../data/models';
import { DEFAULT_PLANS } from '../engine/protocols/registry';
import type { Side } from '../engine/types';
import { HISTORY_QUESTIONNAIRE, SHOULDER_HISTORY_QUESTIONNAIRE, type Questionnaire } from './intake';
import { ANKLE_HISTORY_QUESTIONNAIRE, ANKLE_SAFETY_QUESTIONNAIRE, BALANCE_HISTORY_QUESTIONNAIRE, BALANCE_SAFETY_QUESTIONNAIRE, HIP_HISTORY_QUESTIONNAIRE, HIP_SAFETY_QUESTIONNAIRE, SPINE_HISTORY_QUESTIONNAIRE, SPINE_SAFETY_QUESTIONNAIRE } from './regionQuestionnaires';
import { registerSafetyQuestionnaire, SAFETY_QUESTIONNAIRE, SHOULDER_SAFETY_QUESTIONNAIRE, type SafetyQuestionnaire } from './safety';

/**
 * Assessment pathway registry. Each region supplies its own versioned history and safety
 * questionnaires, default test plan, finer symptom locations, report rows and scope limits. The
 * patient flow, clinician workspace and report are driven from this table, so a new region is
 * added here rather than by copying screens.
 */

export type PathwayRegion = 'knee' | 'shoulder' | 'hip' | 'ankle' | 'spine' | 'balance';

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
  /** A pain area is optional (e.g. balance referrals without pain). */
  symptomMapOptional?: boolean;
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

const row = (protocolId: string, metricId: string, label: string): PathwayMetricRow => ({ protocolId, metricId, label });
const NO_RULES_NOTE = 'No draft consideration rules exist for this region: the clinician records the impression. Nothing is inferred.';

const HIP: Pathway = {
  region: 'hip',
  label: 'Hip',
  history: HIP_HISTORY_QUESTIONNAIRE,
  safety: HIP_SAFETY_QUESTIONNAIRE,
  defaultPlan: DEFAULT_PLANS.hip!,
  subLocations: [
    { id: 'groin', label: 'Groin / front' },
    { id: 'outer', label: 'Outer hip' },
    { id: 'buttock', label: 'Buttock' },
    { id: 'whole', label: 'Whole hip' },
  ],
  isRegion: (id) => id.startsWith('hip') || id.startsWith('groin') || id.startsWith('buttock'),
  reassessQuestions: new Set(['nprs_now', 'nprs_worst', 'nprs_best', 'pattern', 'night', 'aggravating', 'hip_limp', 'func_socks', 'func_stairs', 'func_walk', 'func_car', 'func_chair']),
  sidedRows: [row('hip_flexion_standing', 'hip_flexion_peak', 'Hip flexion, standing (peak)'), row('hip_flexion_standing', 'hip_flexion_trunk_lean', 'Trunk angle at hip flexion peak'), row('hip_abduction_standing', 'hip_abduction_peak', 'Hip abduction, standing (peak)'), row('hip_abduction_standing', 'hip_abduction_trunk_lean', 'Trunk side-lean at abduction peak')],
  trend: row('hip_flexion_standing', 'hip_flexion_peak', 'hip flexion'),
  symmetryRows: [row('hip_flexion_standing', 'hip_flexion_peak', 'Hip flexion (peak)'), row('hip_abduction_standing', 'hip_abduction_peak', 'Hip abduction (peak)')],
  functionalProtocols: [],
  romNote: 'Camera-estimated, active movement while standing: flexion from a 2D side view, abduction from a 2D front view. Pelvic and trunk movement are included and recorded separately. Not interchangeable with goniometry until validated.',
  hasConsiderationRules: false,
  reportTemplate: 'dl-hip-report-1.0.0',
  scopeLimits: [
    'The camera estimates 2D thigh movement forward (side view) and sideways (front view) only. It cannot identify which structure causes pain.',
    'Hip rotation, extension, passive range, joint play, special tests and muscle strength are not measured: they need clinical examination.',
    NO_RULES_NOTE,
  ],
};

const ANKLE: Pathway = {
  region: 'ankle',
  label: 'Ankle and foot',
  history: ANKLE_HISTORY_QUESTIONNAIRE,
  safety: ANKLE_SAFETY_QUESTIONNAIRE,
  defaultPlan: DEFAULT_PLANS.ankle!,
  subLocations: [
    { id: 'outer_ankle', label: 'Outer ankle' },
    { id: 'inner_ankle', label: 'Inner ankle' },
    { id: 'achilles', label: 'Back of heel / Achilles' },
    { id: 'heel_sole', label: 'Under the heel' },
    { id: 'forefoot', label: 'Front of foot / toes' },
    { id: 'whole', label: 'Whole ankle or foot' },
  ],
  isRegion: (id) => id.startsWith('ankle') || id.startsWith('foot') || id.startsWith('calf'),
  reassessQuestions: new Set(['nprs_now', 'nprs_worst', 'nprs_best', 'pattern', 'aggravating', 'ankle_swelling', 'ankle_giving_way', 'func_stairs', 'func_uneven', 'func_tiptoe', 'func_hop', 'func_walk']),
  sidedRows: [row('ankle_knee_to_wall', 'knee_to_wall_shin_angle', 'Knee-to-wall shin angle (heel down)'), row('ankle_knee_to_wall', 'knee_to_wall_heel_rise', 'Heel rise at lunge peak (quality)')],
  trend: row('ankle_knee_to_wall', 'knee_to_wall_shin_angle', 'knee-to-wall shin angle'),
  symmetryRows: [row('ankle_knee_to_wall', 'knee_to_wall_shin_angle', 'Knee-to-wall shin angle')],
  functionalProtocols: ['heel_raise_double'],
  romNote: 'Camera-estimated shin inclination in a weight-bearing lunge with the heel down (2D side view) — a dorsiflexion proxy, not the ankle joint angle. Not interchangeable with inclinometry or the toe-to-wall distance until validated.',
  hasConsiderationRules: false,
  reportTemplate: 'dl-ankle-report-1.0.0',
  scopeLimits: [
    'The camera estimates shin angle in a lunge and heel-raise repetitions only. It cannot identify which structure causes pain.',
    'Ligament laxity, swelling, subtalar and midfoot movement, sensation, circulation and calf strength need clinical examination.',
    'Shoes, socks with patterns and the other foot overlapping hide the landmarks: those captures are refused.',
    NO_RULES_NOTE,
  ],
};

const SPINE: Pathway = {
  region: 'spine',
  label: 'Back and neck',
  history: SPINE_HISTORY_QUESTIONNAIRE,
  safety: SPINE_SAFETY_QUESTIONNAIRE,
  defaultPlan: DEFAULT_PLANS.spine!,
  subLocations: [
    { id: 'central', label: 'Central' },
    { id: 'one_side', label: 'One side' },
    { id: 'both_sides', label: 'Both sides' },
    { id: 'spreading', label: 'Spreading into a limb' },
  ],
  isRegion: (id) => /^(lower_back|mid_back|upper_back|neck)/.test(id),
  reassessQuestions: new Set(['nprs_now', 'nprs_worst', 'nprs_best', 'pattern', 'night', 'aggravating', 'leg_symptoms', 'arm_symptoms', 'func_sitting', 'func_bending', 'func_turn_head', 'func_lifting', 'func_walk']),
  sidedRows: [row('trunk_side_bend', 'trunk_side_bend_peak', 'Trunk side bend (peak)')],
  trend: row('trunk_forward_bend', 'trunk_forward_bend_peak', 'trunk forward bend'),
  symmetryRows: [row('trunk_side_bend', 'trunk_side_bend_peak', 'Trunk side bend (peak)')],
  functionalProtocols: ['trunk_forward_bend', 'neck_flexion_extension'],
  romNote: 'Camera-estimated trunk inclination (side view) and side bend (front view) combine hip, pelvis and spinal movement; the neck value is a head-on-trunk change from the start position. None of these is segmental spinal range, and posture is not interpreted.',
  hasConsiderationRules: false,
  reportTemplate: 'dl-spine-report-1.0.0',
  scopeLimits: [
    'Pose landmarks resolve the trunk as a line and the head as a point relative to the shoulder. Spinal curvature, segmental movement, alignment and structural findings cannot be measured and are not inferred from posture.',
    'Neurological examination (strength, reflexes, sensation), neural tension tests and neck rotation need clinical examination.',
    'Red-flag screening relies on the patient’s answers and the clinician, never on the camera.',
    NO_RULES_NOTE,
  ],
};

const BALANCE: Pathway = {
  region: 'balance',
  label: 'Balance and mobility',
  history: BALANCE_HISTORY_QUESTIONNAIRE,
  safety: BALANCE_SAFETY_QUESTIONNAIRE,
  defaultPlan: DEFAULT_PLANS.balance!,
  subLocations: [],
  isRegion: () => false,
  reassessQuestions: new Set(['falls_12m', 'fear_of_falling', 'unsteady', 'dizziness', 'walking_aid', 'func_chair_no_arms', 'func_outdoors', 'func_stairs', 'func_floor']),
  sidedRows: [row('single_leg_stance', 'single_leg_stance_time', 'Single-leg stance time (standing leg)')],
  trend: row('single_leg_stance', 'single_leg_stance_time', 'single-leg stance time'),
  symmetryRows: [row('single_leg_stance', 'single_leg_stance_time', 'Single-leg stance time')],
  functionalProtocols: ['march_in_place'],
  romNote: 'Timed from video at the capture frame rate (about ±1 frame). Eyes open, firm floor. No fall-risk score is calculated.',
  hasConsiderationRules: false,
  reportTemplate: 'dl-balance-report-1.0.0',
  scopeLimits: [
    'The camera times single-leg stance and counts marching steps. It does NOT assess fall risk, and no fall-risk score or category is produced.',
    'Walking gait, turning, reactive balance, vestibular function, vision, sensation, strength and blood pressure on standing need clinical assessment.',
    'Balance tests are done only with a support within reach, and with a person present after repeated falls (safety screen).',
    NO_RULES_NOTE,
  ],
  symptomMapOptional: true,
};

export const PATHWAYS: Record<PathwayRegion, Pathway> = { knee: KNEE, shoulder: SHOULDER, hip: HIP, ankle: ANKLE, spine: SPINE, balance: BALANCE };
for (const p of Object.values(PATHWAYS)) registerSafetyQuestionnaire(p.safety);

/** The pathway an assessment belongs to (legacy assessments without a region are knee). */
export function pathwayFor(a: Pick<Assessment, 'region'> | undefined | null): Pathway {
  return a && isPathwayRegion(a.region) ? PATHWAYS[a.region] : KNEE;
}

export const PATHWAY_ORDER: PathwayRegion[] = ['knee', 'shoulder', 'hip', 'ankle', 'spine', 'balance'];
export const isPathwayRegion = (r: unknown): r is PathwayRegion => typeof r === 'string' && (PATHWAY_ORDER as string[]).includes(r);
