import type { ChallengeClip } from '../data/models';
import type { Landmark } from '../engine/types';

/**
 * Phase 51: occlusion challenge clips from consenting volunteers. Landmarks only, in the same
 * per-frame encoding as the lab fixture (33 landmarks × x, y, visibility as uint16 base64), so
 * Phase 22 can replay real clips through the same pipeline as the rendered lab set. The ground
 * truth is the operator's "occluder in place" marking per frame, not a reference angle.
 *
 * This module writes and checks clips. Choosing and locking the challenge set, and judging pass or
 * fail, belong to the Phase 22 reviewers.
 */
export const CHALLENGE_FORMAT = 'dheepika-challenge-set';
export const CONSENT_VERSION = 'challenge-consent-draft-1';

const q = (v: number) => Math.max(0, Math.min(65535, Math.round(((v + 0.5) / 2) * 65535)));

export function encodeLandmarks(lms: Landmark[] | null): string | null {
  if (!lms || lms.length < 33) return null;
  const bytes = new Uint8Array(33 * 6);
  for (let k = 0; k < 33; k++) {
    const l = lms[k];
    [l.x, l.y, l.visibility ?? 0].forEach((v, j) => {
      const u = q(v);
      bytes[k * 6 + j * 2] = u & 0xff;
      bytes[k * 6 + j * 2 + 1] = u >> 8;
    });
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface ClipProblem {
  clipId: string;
  problem: string;
}

/** Structural checks before a clip can be offered for a locked set. */
export function checkClip(c: ChallengeClip): string[] {
  const p: string[] = [];
  const n = c.t.length;
  if (n < 30) p.push('fewer than 30 frames');
  if (c.frames.length !== n || c.occluded.length !== n) p.push('frame, time and occlusion arrays differ in length');
  if (c.t.some((t, i) => i > 0 && t <= c.t[i - 1])) p.push('frame times are not increasing');
  if (!c.occluded.some(Boolean)) p.push('no frame is marked as occluded');
  if (c.occluded.every(Boolean)) p.push('every frame is marked as occluded (no unoccluded reference)');
  if (c.frames.filter((f) => f !== null).length < n / 2) p.push('the person was detected in under half the frames');
  if (!c.label.occluder.trim() || !c.label.joints.length || !c.label.view.trim()) p.push('labels incomplete (occluder, joints, view)');
  if (!c.consent.participantCode.trim()) p.push('no participant code');
  if (c.consent.videoRetained !== false) p.push('video must not be stored with the clip');
  return p;
}

/** Export clips in a fixture-like format for the Phase 22 pipeline. Fails if any clip has a problem. */
export function exportChallengeSet(clips: ChallengeClip[], setName: string, at: string) {
  const problems: ClipProblem[] = clips.flatMap((c) => checkClip(c).map((problem) => ({ clipId: c.id, problem })));
  if (problems.length) return { ok: false as const, problems };
  return {
    ok: true as const,
    file: {
      kind: CHALLENGE_FORMAT,
      version: 1,
      set: setName,
      exportedAt: at,
      source: 'Consenting volunteers recorded with Dheepika Lab (landmarks only; no video). Not patients; not a clinical recording.',
      encoding: 'per frame: 33 landmarks x (x, y, visibility), each uint16 = round((v + 0.5) / 2 * 65535) little-endian, base64; null = no pose',
      groundTruth: 'occluded[i] = operator held "occluder in place" at frame i; no reference angle',
      scenarios: clips.map((c) => ({
        id: c.id,
        title: `${c.label.occluder} over ${c.label.joints.join(', ')} (${c.label.view})`,
        label: c.label,
        participant: c.consent.participantCode,
        frameWidth: c.frameWidth,
        frameHeight: c.frameHeight,
        t: c.t,
        occluded: c.occluded,
        frames: c.frames,
      })),
    },
  };
}
