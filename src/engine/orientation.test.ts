import { describe, expect, it } from 'vitest';
import { LM } from './landmarks';
import { anatomicalNearSide, detectOrientation, MotionPipeline } from './pipeline';
import { SIM_PROVIDER } from './protocols/simulate';
import { synthesize, type SynthScene } from './pose/synthetic';
import type { Landmark } from './types';

const W = 720;
const H = 1280;
const mirror = (l: Landmark[]) => l.map((p) => ({ ...p, x: 1 - p.x }));

describe('Phase 9 — orientation and mirroring', () => {
  const lateral: SynthScene[] = [
    { kind: 'standing_lateral', side: 'left', kneeFlexion: 40 },
    { kind: 'standing_lateral', side: 'right', kneeFlexion: 40 },
    { kind: 'supine_heel_slide', side: 'left', kneeFlexion: 80 },
    { kind: 'supine_heel_slide', side: 'right', kneeFlexion: 80 },
    { kind: 'sit_to_stand_lateral', side: 'left', kneeFlexion: 90 },
    { kind: 'sit_to_stand_lateral', side: 'right', kneeFlexion: 90 },
  ];

  it.each(lateral)('reads the near side from anatomy, standing, sitting and lying (%o)', (scene) => {
    const side = (scene as { side: 'left' | 'right' }).side;
    const lms = synthesize(scene);
    expect(anatomicalNearSide(lms, W, H)?.side).toBe(side);
    expect(detectOrientation(lms, W, H).view).toBe(side === 'left' ? 'lateral_left' : 'lateral_right');
  });

  it('a mirrored stream reads as the opposite side — so inference must only see un-mirrored frames', () => {
    const lms = synthesize({ kind: 'standing_lateral', side: 'left' });
    expect(anatomicalNearSide(mirror(lms), W, H)?.side).toBe('right');
  });

  it('does not decide from anatomy when the nose is hidden or the head faces the camera', () => {
    const lms = synthesize({ kind: 'standing_lateral', side: 'left' });
    const noNose = lms.map((l, i) => (i === LM.nose ? { ...l, visibility: 0.1 } : l));
    expect(anatomicalNearSide(noNose, W, H)).toBeNull();
    const facingCam = lms.map((l, i) => (i === LM.nose ? { ...l, x: lms[LM.leftEar].x, y: lms[LM.leftEar].y } : l));
    expect(anatomicalNearSide(facingCam, W, H)).toBeNull();
  });

  it('front vs back view, and a partly turned body is unknown rather than guessed', () => {
    const front = synthesize({ kind: 'standing_anterior' });
    expect(detectOrientation(front, W, H).view).toBe('anterior');
    // Seen from behind: left shoulder on image-left, face not visible.
    const back = mirror(front).map((l, i) => (i === LM.nose ? { ...l, visibility: 0.1 } : l));
    expect(detectOrientation(back, W, H).view).toBe('posterior');
    // Half-turned: shoulder width between the frontal and sagittal bands.
    const half = front.map((l, i) => (i === LM.leftShoulder || i === LM.rightShoulder ? { ...l, x: 0.5 + (l.x - 0.5) * 0.6 } : l));
    expect(detectOrientation(half, W, H).view).toBe('unknown');
  });

  it('never switches view on a single ambiguous frame (time-window vote)', () => {
    const p = new MotionPipeline();
    const left = synthesize({ kind: 'standing_lateral', side: 'left' });
    const right = synthesize({ kind: 'standing_lateral', side: 'right' });
    let f = p.process({ timestamp: 0, width: W, height: H, poses: [left], inferenceMs: 1, provider: SIM_PROVIDER });
    for (let t = 33; t < 700; t += 33) f = p.process({ timestamp: t, width: W, height: H, poses: [left], inferenceMs: 1, provider: SIM_PROVIDER });
    expect(f.orientation).toBe('lateral_left');
    // One contradicting frame (a glitch in place, no body movement) does not flip the view.
    const glitch = left.map((l, i) => (i === LM.nose ? { ...l, x: right[LM.nose].x } : l));
    f = p.process({ timestamp: 733, width: W, height: H, poses: [glitch], inferenceMs: 1, provider: SIM_PROVIDER });
    expect(f.orientation).toBe('lateral_left');
  });
});

describe('Phase 9 — a confirmed side view is not flipped by weak depth cues', () => {
  it('keeps the anatomically confirmed side when later frames only have an ambiguous face direction', () => {
    const p = new MotionPipeline();
    const left = synthesize({ kind: 'supine_heel_slide', side: 'left', kneeFlexion: 60 });
    let t = 0;
    let f = p.process({ timestamp: t, width: W, height: H, poses: [left], inferenceMs: 1, provider: SIM_PROVIDER });
    for (t = 33; t < 600; t += 33) f = p.process({ timestamp: t, width: W, height: H, poses: [left], inferenceMs: 1, provider: SIM_PROVIDER });
    expect(f.orientation).toBe('lateral_left');
    // Nose collapses onto the ear (tiny, meaningless face vector) and depth now favours the right side.
    const ambiguous = left.map((l, i) => (i === LM.nose ? { ...l, x: left[LM.leftEar].x + 0.002, y: left[LM.leftEar].y } : i === LM.rightShoulder || i === LM.rightHip ? { ...l, z: -0.5 } : l));
    for (let k = 0; k < 20; k++, t += 33) f = p.process({ timestamp: t, width: W, height: H, poses: [ambiguous], inferenceMs: 1, provider: SIM_PROVIDER });
    expect(f.orientation).toBe('lateral_left');
  });
});
