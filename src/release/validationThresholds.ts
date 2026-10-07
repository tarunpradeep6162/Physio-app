import type { ClinicSettings } from '../data/models';
import { PROTOCOLS } from '../engine/protocols/registry';

/** One declared metric for each current protocol output under consideration for release. */
export const METRICS_BY_PROTOCOL: Record<string, readonly string[]> = {
  knee_supported_flexion: ['knee_flexion_peak', 'knee_extension_position'],
  knee_sit_to_stand: ['sts_time_5', 'sts_rise_time', 'sts_trunk_lean_peak', 'sts_seated_knee_flexion'],
  knee_squat: ['squat_fppa_left', 'squat_fppa_right', 'squat_depth'],
  shoulder_flexion_active: ['shoulder_flexion_peak', 'shoulder_flexion_trunk_lean'],
  shoulder_abduction_active: ['shoulder_abduction_peak', 'shoulder_abduction_trunk_lean'],
  hip_flexion_standing: ['hip_flexion_peak', 'hip_flexion_trunk_lean'],
  hip_abduction_standing: ['hip_abduction_peak', 'hip_abduction_trunk_lean'],
  ankle_knee_to_wall: ['knee_to_wall_shin_angle', 'knee_to_wall_heel_rise'],
  heel_raise_double: ['heel_raise_count', 'heel_raise_height_angle'],
  trunk_forward_bend: ['trunk_forward_bend_peak', 'trunk_forward_bend_knee_angle'],
  trunk_side_bend: ['trunk_side_bend_peak'],
  neck_flexion_extension: ['neck_flexion_change', 'neck_extension_change'],
  single_leg_stance: ['single_leg_stance_time', 'single_leg_stance_pelvis_sway'],
  march_in_place: ['march_steps', 'march_cadence', 'march_lift_left', 'march_lift_right', 'march_alternation'],
};
export const REQUIRED_VALIDATION_METRICS = [...new Set(
  Object.values(PROTOCOLS).flatMap((protocol) => METRICS_BY_PROTOCOL[protocol.id] ?? []),
)].sort();

type Thresholds = ClinicSettings['releaseThresholds'];

export function validateReleaseThresholds(thresholds: Thresholds): string[] {
  if (!thresholds) return ['Release thresholds are not locked.'];
  const errors: string[] = [];
  if (!thresholds.lockedBy || !Number.isFinite(Date.parse(thresholds.lockedAt))) {
    errors.push('Threshold lock needs an actor and a valid timestamp.');
  }
  for (const protocol of Object.values(PROTOCOLS)) {
    if (!METRICS_BY_PROTOCOL[protocol.id]?.length) {
      errors.push(`No release metrics declared for ${protocol.id}.`);
    }
  }
  for (const metric of REQUIRED_VALIDATION_METRICS) {
    const row = thresholds.values?.[metric];
    if (!row) {
      errors.push(`Missing threshold: ${metric}.`);
      continue;
    }
    if (!Number.isFinite(row.loaWithin) || row.loaWithin <= 0) errors.push(`Invalid LoA for ${metric}.`);
    if (!Number.isFinite(row.maxFailureRate) || row.maxFailureRate < 0 || row.maxFailureRate > 1) {
      errors.push(`Invalid failure rate for ${metric} (use 0–100%).`);
    }
    if (!Number.isFinite(row.minIcc) || row.minIcc < -1 || row.minIcc > 1) {
      errors.push(`Invalid ICC for ${metric} (use −1 to 1).`);
    }
    if (!Number.isSafeInteger(row.minN) || row.minN < 2) errors.push(`Invalid minimum n for ${metric} (at least 2).`);
  }
  for (const metric of Object.keys(thresholds.values ?? {})) {
    if (!REQUIRED_VALIDATION_METRICS.includes(metric)) errors.push(`Unknown or retired metric: ${metric}.`);
  }
  return errors;
}
