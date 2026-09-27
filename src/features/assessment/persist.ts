import type { ExerciseResult } from '../../engine/exerciseRunner';
import { getDefinition } from '../../engine/exercises/definitions';
import { cameraProvenance, type DeviceContext } from '../../engine/provenance';
import type { PostureMetricId } from '../../engine/posture';
import type { PoseProviderInfo } from '../../engine/types';
import type { Measurement, ObservationThresholds, Observation, PatientReportedOutcome, ProType } from '../../data/models';
import { getDb, insert, insertMany, remove, uuid } from '../../data/store';
import type { ScanViewResult } from '../scan/StaticScan';

/** Persistence helpers for the assessment workflow. All writes are audited by the store. */

export function replacePros(patientId: string, assessmentId: string, actorId: string, values: Partial<Record<ProType, PatientReportedOutcome['value']>>, isDemo?: boolean) {
  const existing = getDb().pros.filter((p) => p.assessmentId === assessmentId && p.type in values);
  existing.forEach((p) => remove('pros', p.id, actorId, 'replaced'));
  const now = new Date().toISOString();
  insertMany(
    'pros',
    Object.entries(values)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([type, value]) => ({ id: uuid(), patientId, assessmentId, type: type as ProType, value: value!, recordedAt: now, isDemo })),
    actorId,
  );
}

export function replaceRegions(assessmentId: string, actorId: string, regionIds: string[]) {
  getDb()
    .painRegions.filter((r) => r.assessmentId === assessmentId)
    .forEach((r) => remove('painRegions', r.id, actorId, 'replaced'));
  insertMany('painRegions', regionIds.map((regionId) => ({ id: uuid(), assessmentId, regionId })), actorId);
}

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
    const ms: Measurement[] = r.metrics.map((m) => ({
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

export interface MovementTestOutcome {
  result: ExerciseResult;
  provider: PoseProviderInfo;
  device: DeviceContext;
  filter: string;
}

export function saveMovementTests(patientId: string, assessmentId: string, actorId: string, tests: MovementTestOutcome[], isDemo?: boolean) {
  const ms: Measurement[] = tests
    .filter((o) => o.result.peakRom !== null)
    .map((o) => {
      const def = getDefinition(o.result.prescription.definitionId, o.result.definitionVersion);
      const prov = cameraProvenance({ createdBy: actorId, provider: o.provider, confidence: o.result.meanConfidence ?? 0, filter: o.filter, device: o.device, exercise: { id: def.id, version: def.version } });
      return {
        id: uuid(),
        patientId,
        assessmentId,
        type: def.primary,
        value: Math.round(o.result.peakRom! * 10) / 10,
        unit: 'deg' as const,
        side: o.result.side,
        confidence: o.result.meanConfidence ?? 0,
        category: 'camera_estimate' as const,
        provenance: prov,
        reviewStatus: 'pending' as const,
        createdAt: prov.createdAt,
        isDemo,
      };
    });
  insertMany('measurements', ms, actorId);
  // Left/right asymmetry observation where both sides of the same test were measured.
  const thr = getDb().settings.thresholds.asymmetry;
  const byType = new Map<string, Measurement[]>();
  ms.forEach((m) => byType.set(m.type, [...(byType.get(m.type) ?? []), m]));
  const obs: Observation[] = [];
  for (const [, arr] of byType) {
    const l = arr.find((m) => m.side === 'left');
    const r = arr.find((m) => m.side === 'right');
    if (l && r && Math.abs(l.value - r.value) > thr) {
      const lower = l.value < r.value ? l : r;
      obs.push({ id: uuid(), patientId, assessmentId, measurementId: lower.id, rule: 'asymmetry', threshold: thr, value: Math.round(Math.abs(l.value - r.value) * 10) / 10, status: 'pending', createdAt: lower.createdAt, isDemo });
    }
  }
  insertMany('observations', obs, actorId);
}
