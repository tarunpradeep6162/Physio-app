import { describe, expect, it } from 'vitest';
import { LM } from './landmarks';
import { synthesize } from './pose/synthetic';
import { computePostureMetrics, metricsForView, postureMetricStatus } from './posture';
import { heightScale, plumbX, POSTURE_REGIONS, regionBox } from './postureGeometry';
import type { Landmark } from './types';

const W = 720;
const H = 1280;

/** Camera zoomed onto the upper body (head-and-shoulders framing, as in a laptop webcam). */
const upperBodyOnly = (lms: Landmark[]) => lms.map((l) => ({ ...l, x: 0.5 + (l.x - 0.5) * 2.2, y: (l.y - 0.02) * 2.4 }));

const status = (lms: Landmark[], view: 'anterior' | 'lateral_left' = 'anterior') => new Map(postureMetricStatus(lms, W, H, view).map((s) => [s.id, s]));

describe('Posture grid — every metric is measured or withheld with a reason', () => {
  it('a clear, full-body front view measures every front metric and draws the scale, plumb line and all regions', () => {
    const lms = synthesize({ kind: 'standing_anterior', shoulderTiltDeg: 2.5 });
    const s = status(lms);
    expect([...s.keys()].sort()).toEqual(metricsForView('anterior').sort());
    for (const v of s.values()) expect(v.state).toBe('measured');
    expect(heightScale(lms, 'anterior').ok).toBe(true);
    expect(plumbX(lms, 'anterior').ok).toBe(true);
    for (const r of POSTURE_REGIONS) expect(regionBox(lms, r, 'anterior', W, H).ok).toBe(true);
    // The legacy helper returns exactly the measured subset.
    expect(computePostureMetrics(lms, W, H, 'anterior').map((m) => m.id).sort()).toEqual([...s.values()].filter((x) => x.state === 'measured').map((x) => x.id).sort());
  });

  it('a phone held in front of the body withholds shoulder, pelvis and trunk measures — with the reason — but not head tilt', () => {
    const s = status(synthesize({ kind: 'standing_anterior', handsInFront: true }));
    for (const id of ['shoulder_level', 'pelvic_level', 'trunk_lateral_lean'] as const) {
      const m = s.get(id)!;
      expect(m.state).toBe('withheld');
      if (m.state === 'withheld') expect(m.reason).toBe('hands_in_front');
    }
    expect(s.get('head_tilt')!.state).toBe('measured');
  });

  it('head-and-shoulders framing never produces pelvis, knee or full-body results (the webcam screenshot case)', () => {
    const lms = upperBodyOnly(synthesize({ kind: 'standing_anterior' }));
    expect(lms[LM.leftHip].y).toBeGreaterThan(1);
    const s = status(lms);
    const pelvis = s.get('pelvic_level')!;
    expect(pelvis.state).toBe('withheld');
    if (pelvis.state === 'withheld') {
      expect(pelvis.reason).toBe('out_of_frame');
      expect(pelvis.missing).toContain(LM.leftHip);
    }
    expect(s.get('knee_frontal_left')!.state).toBe('withheld');
    expect(s.get('head_tilt')!.state).toBe('measured');
    // No height scale without the feet, no plumb line without the ankles, no full-body or leg zoom.
    expect(heightScale(lms, 'anterior').ok).toBe(false);
    expect(plumbX(lms, 'anterior').ok).toBe(false);
    expect(regionBox(lms, 'full_body', 'anterior', W, H).ok).toBe(false);
    expect(regionBox(lms, 'lower_limb', 'anterior', W, H).ok).toBe(false);
    expect(regionBox(lms, 'head_neck', 'anterior', W, H).ok).toBe(true);
  });

  it('a side view uses the near-side ankle for the plumb line and only near-side landmarks for regions', () => {
    const lms = synthesize({ kind: 'standing_lateral', side: 'left' });
    const p = plumbX(lms, 'lateral_left');
    expect(p.ok && Math.abs(p.value - lms[LM.leftAnkle].x) < 1e-9).toBe(true);
    const box = regionBox(lms, 'head_neck', 'lateral_left', W, H);
    expect(box.ok).toBe(true);
    if (box.ok) {
      // The crop contains the ear and shoulder it was built from and keeps the requested aspect.
      for (const i of [LM.leftEar, LM.leftShoulder]) {
        expect(lms[i].x).toBeGreaterThan(box.value.x);
        expect(lms[i].x).toBeLessThan(box.value.x + box.value.w);
        expect(lms[i].y).toBeGreaterThan(box.value.y);
        expect(lms[i].y).toBeLessThan(box.value.y + box.value.h);
      }
      expect((box.value.w * W) / (box.value.h * H)).toBeCloseTo(4 / 3, 5);
    }
  });

  it('a hidden landmark withholds the metric as occluded, naming the joint', () => {
    const lms = synthesize({ kind: 'standing_anterior' });
    lms[LM.rightEar] = { ...lms[LM.rightEar], visibility: 0.1 };
    const head = status(lms).get('head_tilt')!;
    expect(head.state).toBe('withheld');
    if (head.state === 'withheld') expect(head).toMatchObject({ reason: 'occluded', missing: [LM.rightEar] });
  });
});

describe('Posture grid — zoom to the patient-reported pain area', () => {
  it('maps pain-map regions to scan regions', async () => {
    const { postureRegionFor } = await import('./postureGeometry');
    expect(postureRegionFor('neck_side_left')).toBe('head_neck');
    expect(postureRegionFor('head')).toBe('head_neck');
    expect(postureRegionFor('lower_back_center')).toBe('trunk');
    expect(postureRegionFor('shoulder_right')).toBe('trunk');
    expect(postureRegionFor('knee_left')).toBe('lower_limb');
    expect(postureRegionFor('hip_left_lateral')).toBe('lower_limb');
    expect(postureRegionFor('hand_right')).toBe('full_body');
  });
  it('zooms to fit the region, never below 1× or above the maximum', async () => {
    const { zoomToBox } = await import('./postureGeometry');
    expect(zoomToBox({ x: 0.4, y: 0.1, w: 0.2, h: 0.15 })).toEqual({ fx: 0.5, fy: 0.175, scale: 2.2 });
    expect(zoomToBox({ x: 0, y: 0, w: 1, h: 1 }).scale).toBe(1);
    expect(zoomToBox({ x: 0.2, y: 0.2, w: 0.5, h: 0.4 }).scale).toBeCloseTo(1.8, 5);
  });
});

describe('Posture grid — outline of the exact area the patient marked', () => {
  it('boxes the marked knee only, and withholds the box when that knee is hidden', async () => {
    const { reportedAreaBox } = await import('./postureGeometry');
    const lms = synthesize({ kind: 'standing_anterior' });
    const b = reportedAreaBox(lms, 'knee_left', W, H);
    expect(b.ok).toBe(true);
    if (b.ok) {
      const inside = (i: number) => lms[i].x > b.value.x && lms[i].x < b.value.x + b.value.w && lms[i].y > b.value.y && lms[i].y < b.value.y + b.value.h;
      expect(inside(LM.leftKnee)).toBe(true);
      expect(inside(LM.leftHip)).toBe(false);
      expect(inside(LM.leftAnkle)).toBe(false);
    }
    const hidden = lms.map((l, i) => (i === LM.leftKnee ? { ...l, visibility: 0.1 } : l));
    const h = reportedAreaBox(hidden, 'knee_left', W, H);
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.missing).toEqual([LM.leftKnee]);
  });
});
