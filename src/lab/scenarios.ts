import { LM } from '../engine/landmarks';
import type { MeasurementType } from '../engine/measurements';
import type { PostureMetricId } from '../engine/posture';
import { sceneAt } from '../engine/protocols/simulate';
import { synthesize, type SynthScene } from '../engine/pose/synthetic';
import type { Landmark, Side } from '../engine/types';
import type { Figure, Rect, RenderOptions } from '../camera/mannequin';

/**
 * Tracking-lab scenarios: reproducible, rendered test sequences for the failure modes named in
 * the tracking audit. Each scenario is labelled SYNTHETIC (rendered mannequin) — none of these
 * figures is a person, and no result from them is an accuracy claim.
 */

export type LabMeasure = { kind: 'angle'; type: MeasurementType; side: Side } | { kind: 'posture'; id: PostureMetricId };

export interface ScenarioFrame {
  figures: Figure[];
  render: RenderOptions;
  /** Index of the patient in `figures` (default 0). */
  patient?: number;
}

export interface Scenario {
  id: string;
  title: string;
  /** Failure mode this scenario reproduces. */
  failure: string;
  durationSec: number;
  /** Camera frame rate of the rendered sequence. */
  cameraFps: number;
  /** Process every k-th camera frame (simulates slow inference / low delivered FPS). */
  processEvery?: number;
  /** Motion-blur exposure in ms (0 = sharp). Rendered as the mean of sub-frames. */
  exposureMs?: number;
  measure: LabMeasure;
  frame(t: number): ScenarioFrame;
}

const W = 720;
const H = 1280;

export function translate(lms: Landmark[], dx: number, dy: number): Landmark[] {
  return lms.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy }));
}

const synth = (s: SynthScene) => synthesize(s, { width: W, height: H });
const heel = (t: number, tempo = 1, peak = 110) => synth(sceneAt('knee_supported_flexion', 'left', t, { peak, tempo, cycles: 3 })!);
/** A phone held in both hands in front of the belly and hips (the reference-screenshot situation). */
const HELD_PHONE: Rect = { x: 0.42, y: 0.36, w: 0.16, h: 0.26 };
/** A free-standing object covering the torso and hips, with the arms down (no hands involved). */
const OBJECT: Rect = { x: 0.33, y: 0.3, w: 0.34, h: 0.34 };
const KNEE_L: LabMeasure = { kind: 'angle', type: 'knee_flexion', side: 'left' };
const SH_FLEX_L: LabMeasure = { kind: 'angle', type: 'shoulder_flexion', side: 'left' };
const SH_ABD_L: LabMeasure = { kind: 'angle', type: 'shoulder_abduction', side: 'left' };
const shFlex = (t: number, side: Side = 'left') => synth(sceneAt('shoulder_flexion_active', side, t, { peak: 150, cycles: 3 })!);
const shAbd = (t: number) => synth(sceneAt('shoulder_abduction_active', 'left', t, { peak: 140, cycles: 3 })!);

const sts = (t: number) => synth(sceneAt('knee_sit_to_stand', 'left', t, { peak: 92, tempo: 1 })!);
const STS_CHAIR = (() => {
  const hip = synth({ kind: 'sit_to_stand_lateral', side: 'left', kneeFlexion: 92, trunkLean: 8 })[LM.leftHip];
  return { x: hip.x, y: hip.y + 0.025 };
})();
const squat = (t: number) => synth(sceneAt('knee_squat', null, t, { valgusLeft: 8, valgusRight: 2 })!);

export const SCENARIOS: Scenario[] = [
  {
    id: 'rest_supine',
    title: 'Stationary, supine heel slide held at 45°',
    failure: 'stationary jitter',
    durationSec: 4,
    cameraFps: 30,
    measure: KNEE_L,
    frame: () => ({ figures: [{ lms: synth({ kind: 'supine_heel_slide', side: 'left', kneeFlexion: 45 }) }], render: { noise: 6, mat: true } }),
  },
  {
    id: 'rest_standing',
    title: 'Stationary, standing side view, knee bent 30°',
    failure: 'stationary jitter',
    durationSec: 4,
    cameraFps: 30,
    measure: KNEE_L,
    frame: () => ({ figures: [{ lms: synth({ kind: 'standing_lateral', side: 'left', kneeFlexion: 30 }) }], render: { noise: 6 } }),
  },
  {
    id: 'heel_slide',
    title: 'Heel slide, normal tempo (1.6 s up), 3 cycles',
    failure: 'lag / peak suppression (normal speed)',
    durationSec: 12,
    cameraFps: 30,
    measure: KNEE_L,
    frame: (t) => ({ figures: [{ lms: heel(t) }], render: { noise: 4, mat: true } }),
  },
  {
    id: 'heel_slide_fast',
    title: 'Heel slide, fast (0.56 s up) with 25 ms motion blur',
    failure: 'fast movement',
    durationSec: 6,
    cameraFps: 30,
    exposureMs: 25,
    measure: KNEE_L,
    frame: (t) => ({ figures: [{ lms: heel(t, 0.35) }], render: { noise: 4, mat: true } }),
  },
  {
    id: 'low_light',
    title: 'Heel slide in a dim room (22% brightness, heavy sensor noise)',
    failure: 'low light',
    durationSec: 12,
    cameraFps: 30,
    measure: KNEE_L,
    frame: (t) => ({ figures: [{ lms: heel(t) }], render: { brightness: 0.22, noise: 14, mat: true } }),
  },
  {
    id: 'slow_inference',
    title: 'Heel slide processed at 3 fps (slow device)',
    failure: 'slow inference',
    durationSec: 12,
    cameraFps: 30,
    processEvery: 10,
    measure: KNEE_L,
    frame: (t) => ({ figures: [{ lms: heel(t) }], render: { noise: 4, mat: true } }),
  },
  {
    id: 'side_view_right',
    title: 'Standing side view, RIGHT side toward camera, knee bending 0→70°',
    failure: 'side view / left-right labelling',
    durationSec: 5,
    cameraFps: 30,
    measure: { kind: 'angle', type: 'knee_flexion', side: 'right' },
    frame: (t) => {
      const f = 35 - 35 * Math.cos((2 * Math.PI * t) / 2.5);
      return { figures: [{ lms: synth({ kind: 'standing_lateral', side: 'right', kneeFlexion: f }) }], render: { noise: 4 } };
    },
  },
  {
    id: 'mirrored_stream',
    title: 'Same left-side movement, but the camera stream is mirrored',
    failure: 'front-camera mirroring',
    durationSec: 5,
    cameraFps: 30,
    measure: KNEE_L,
    frame: (t) => {
      const f = 35 - 35 * Math.cos((2 * Math.PI * t) / 2.5);
      return { figures: [{ lms: synth({ kind: 'standing_lateral', side: 'left', kneeFlexion: f }) }], render: { noise: 4, mirror: true } };
    },
  },
  {
    id: 'phone_occlusion',
    title: 'Front view, phone held in both hands in front of the belly and hips',
    failure: 'phone obstruction',
    durationSec: 4,
    cameraFps: 30,
    measure: { kind: 'posture', id: 'pelvic_level' },
    frame: () => ({ figures: [{ lms: synth({ kind: 'standing_anterior', pelvicTiltDeg: 2, handsInFront: true }) }], render: { noise: 4, occluders: [HELD_PHONE] } }),
  },
  {
    id: 'object_occlusion',
    title: 'Front view, a free-standing object covers torso and hips (arms down)',
    failure: 'object obstruction without hands (known limit)',
    durationSec: 4,
    cameraFps: 30,
    measure: { kind: 'posture', id: 'pelvic_level' },
    frame: () => ({ figures: [{ lms: synth({ kind: 'standing_anterior', pelvicTiltDeg: 2 }) }], render: { noise: 4, occluders: [OBJECT] } }),
  },
  {
    id: 'knee_occlusion',
    title: 'Heel slide with the tested knee hidden behind an object from 4 s',
    failure: 'single-joint obstruction',
    durationSec: 10,
    cameraFps: 30,
    measure: KNEE_L,
    frame: (t) => {
      const lms = heel(t);
      const k = lms[LM.leftKnee];
      const occ: Rect[] = t > 4 ? [{ x: k.x - 0.09, y: k.y - 0.08, w: 0.18, h: 0.16 }] : [];
      return { figures: [{ lms }], render: { noise: 4, mat: true, occluders: occ } };
    },
  },
  {
    id: 'partial_body',
    title: 'Front view, camera too low: ankles below the frame',
    failure: 'partial body',
    durationSec: 3,
    cameraFps: 30,
    measure: { kind: 'posture', id: 'knee_frontal_left' },
    frame: () => ({ figures: [{ lms: translate(synth({ kind: 'standing_anterior' }), 0, 0.14) }], render: { noise: 4 } }),
  },
  {
    id: 'leave_frame',
    title: 'Side view: patient walks out of frame and back',
    failure: 'person leaving frame',
    durationSec: 7,
    cameraFps: 30,
    measure: KNEE_L,
    frame: (t) => {
      const dx = t < 2 ? 0 : t < 3.2 ? ((t - 2) / 1.2) * 0.85 : t < 4.5 ? 0.85 : t < 5.7 ? 0.85 - ((t - 4.5) / 1.2) * 0.85 : 0;
      return { figures: [{ lms: translate(synth({ kind: 'standing_lateral', side: 'left', kneeFlexion: 30 }), dx, 0) }], render: { noise: 4 } };
    },
  },
  {
    id: 'sit_to_stand',
    title: 'Five-times sit-to-stand, side view (protocol scenario)',
    failure: 'protocol: timed functional test',
    durationSec: 16,
    cameraFps: 30,
    measure: KNEE_L,
    frame: (t) => ({ figures: [{ lms: sts(t) }], render: { noise: 4, chair: STS_CHAIR } }),
  },
  {
    id: 'squat_front',
    title: 'Double-leg squat, front view (protocol scenario)',
    failure: 'protocol: frontal-plane alignment',
    durationSec: 14,
    cameraFps: 30,
    measure: { kind: 'posture', id: 'knee_frontal_left' },
    frame: (t) => ({ figures: [{ lms: squat(t) }], render: { noise: 4 } }),
  },
  {
    id: 'shoulder_flexion',
    title: 'Shoulder flexion, side view, left arm 5→150° (protocol scenario)',
    failure: 'protocol: shoulder flexion',
    durationSec: 14,
    cameraFps: 30,
    measure: SH_FLEX_L,
    frame: (t) => ({ figures: [{ lms: shFlex(t) }], render: { noise: 4 } }),
  },
  {
    id: 'shoulder_abduction',
    title: 'Shoulder abduction, front view, left arm 5→140° (protocol scenario)',
    failure: 'protocol: shoulder abduction',
    durationSec: 14,
    cameraFps: 30,
    measure: SH_ABD_L,
    frame: (t) => ({ figures: [{ lms: shAbd(t) }], render: { noise: 4 } }),
  },
  {
    id: 'shoulder_elbow_occlusion',
    title: 'Shoulder abduction with the tested elbow hidden behind an object from 5 s',
    failure: 'single-joint obstruction (arm)',
    durationSec: 12,
    cameraFps: 30,
    measure: SH_ABD_L,
    frame: (t) => {
      const lms = shAbd(t);
      const e = lms[LM.leftElbow];
      const occ: Rect[] = t > 5 ? [{ x: e.x - 0.08, y: e.y - 0.06, w: 0.16, h: 0.12 }] : [];
      return { figures: [{ lms }], render: { noise: 4, occluders: occ } };
    },
  },
  {
    id: 'shoulder_wrong_side',
    title: 'Shoulder flexion measured for the LEFT arm while the RIGHT side faces the camera',
    failure: 'wrong side toward camera',
    durationSec: 8,
    cameraFps: 30,
    measure: SH_FLEX_L,
    frame: (t) => ({ figures: [{ lms: shFlex(t, 'right') }], render: { noise: 4 } }),
  },
  {
    id: 'second_person',
    title: 'A second person walks into view behind the patient',
    failure: 'multiple people',
    durationSec: 6,
    cameraFps: 30,
    measure: KNEE_L,
    frame: (t) => {
      const patient = translate(synth({ kind: 'standing_lateral', side: 'left', kneeFlexion: 30 }), -0.15, 0);
      const figs: Figure[] = [{ lms: patient }];
      if (t > 1.5) {
        const x = Math.min(0.32, -0.6 + (t - 1.5) * 0.6);
        figs.unshift({ lms: translate(synth({ kind: 'standing_anterior', scale: 0.8 }), x, -0.04), shirt: '#8a3b2f', pants: '#5a5040', skin: '#a86f4c' });
      }
      return { figures: figs, render: { noise: 4 }, patient: figs.length - 1 };
    },
  },
];

/** Landmarks of figure 0 hidden by occluders or outside the frame (ground truth). */
export function hiddenLandmarks(lms: Landmark[], occluders: Rect[] = []): Set<number> {
  const out = new Set<number>();
  lms.forEach((l, i) => {
    if (l.x < 0 || l.x > 1 || l.y < 0 || l.y > 1) out.add(i);
    for (const r of occluders) if (l.x >= r.x && l.x <= r.x + r.w && l.y >= r.y && l.y <= r.y + r.h) out.add(i);
  });
  return out;
}
