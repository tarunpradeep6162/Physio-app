import { cameraProvenance } from '../../engine/provenance';
import type { PostureMetricId } from '../../engine/posture';
import type { Measurement, ObservationThresholds, Observation } from '../../data/models';
import { getDb, insert, insertMany, uuid } from '../../data/store';
import type { ScanViewResult } from '../scan/StaticScan';

/** Persistence helpers for the assessment workflow. All writes are audited by the store. */

const RULE_FOR: Partial<Record<PostureMetricId, keyof ObservationThresholds>> = {
  shoulder_level: 'shoulder_level',
  pelvic_level: 'pelvic_level',
  head_tilt: 'head_tilt',
  trunk_lateral_lean: 'trunk_lateral_lean',
  knee_frontal_left: 'knee_frontal',
  knee_frontal_right: 'knee_frontal',
  ear_shoulder_line: 'ear_shoulder_line',
  trunk_sagittal: 'trunk_sagittal',
};

/**
 * Stores posture-scan results: one camera_scan per view (landmarks, optional image, provenance),
 * one measurement per metric (pending clinician review), and an algorithmic observation for each
 * metric that exceeds the clinician-configured threshold.
 */
export function saveScan(patientId: string, assessmentId: string, actorId: string, results: ScanViewResult[], isDemo?: boolean) {
  const thr = getDb().settings.thresholds;
  for (const r of results) {
    const prov = cameraProvenance({ createdBy: actorId, provider: r.provider, confidence: r.confidence, filter: 'one_euro', view: r.view, device: r.device });
    const scan = { id: uuid(), patientId, assessmentId, kind: 'static_posture' as const, view: r.view, frameWidth: r.frameWidth, frameHeight: r.frameHeight, landmarks: r.landmarks, imageDataUrl: r.image, provenance: prov, createdAt: prov.createdAt, isDemo };
    insert('scans', scan, actorId);
    const ms: Measurement[] = r.metrics.filter((m) => m.level === 'high' || m.level === 'moderate').map((m) => ({
      id: uuid(),
      patientId,
      assessmentId,
      scanId: scan.id,
      type: `posture.${m.id}`,
      value: Math.round(m.value * 10) / 10,
      unit: m.unit,
      direction: m.direction,
      sd: Math.round(m.sd * 100) / 100,
      confidence: Math.round(m.confidence * 1000) / 1000,
      category: 'camera_estimate',
      provenance: { ...prov, confidence: m.confidence },
      reviewStatus: 'pending',
      createdAt: prov.createdAt,
      isDemo,
    }));
    insertMany('measurements', ms, actorId);
    const obs: Observation[] = [];
    for (const m of ms) {
      const rule = RULE_FOR[m.type.replace('posture.', '') as PostureMetricId];
      if (!rule || m.unit !== 'deg') continue;
      if (m.value > thr[rule]) obs.push({ id: uuid(), patientId, assessmentId, measurementId: m.id, rule, threshold: thr[rule], value: m.value, status: 'pending', createdAt: m.createdAt, isDemo });
    }
    insertMany('observations', obs, actorId);
  }
}
