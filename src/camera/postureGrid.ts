import { LM } from '../engine/landmarks';
import type { PostureMetricId, PostureMetricStatus } from '../engine/posture';
import { heightScale, plumbX } from '../engine/postureGeometry';
import type { Landmark, ViewOrientation } from '../engine/types';
import { drawSkeleton, label } from './overlay';

/**
 * Clinical posture grid: reference grid, relative height scale, plumb line and named level lines.
 * Only measured metrics get a line and a number; a withheld metric draws nothing on the body (the
 * HUD states why). The height scale is relative (ankle = 0, nose = 100), never centimetres.
 */

const unit = (h: number) => Math.max(1.5, h / 360);

export const GRID_COLORS = {
  grid: 'rgba(120, 200, 230, 0.16)',
  gridMajor: 'rgba(120, 200, 230, 0.3)',
  ruler: 'rgba(236, 253, 250, 0.85)',
  plumb: '#22D3C5',
  level: '#F5B84A',
  reference: 'rgba(236, 253, 250, 0.45)',
};

export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const u = unit(h);
  const step = h / 16;
  ctx.save();
  ctx.lineWidth = 1 * u * 0.6;
  for (let i = 1; i * step < w || i * step < h; i++) {
    const major = i % 4 === 0;
    ctx.strokeStyle = major ? GRID_COLORS.gridMajor : GRID_COLORS.grid;
    if (i * step < w) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, h);
      ctx.stroke();
    }
    if (i * step < h) {
      ctx.beginPath();
      ctx.moveTo(0, i * step);
      ctx.lineTo(w, i * step);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Relative height ruler on the frame edge: 0 at the ankles, 100 at the nose (legend is in the HUD). */
export function drawHeightRuler(ctx: CanvasRenderingContext2D, ankleY: number, noseY: number, h: number, mirrored: boolean) {
  const u = unit(h);
  const x = 14 * u;
  const y0 = ankleY * h;
  const y1 = noseY * h;
  ctx.save();
  ctx.strokeStyle = GRID_COLORS.ruler;
  ctx.lineWidth = 1.5 * u;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  for (let p = 0; p <= 100; p += 10) {
    const y = y0 + (y1 - y0) * (p / 100);
    const len = p % 50 === 0 ? 12 : p % 20 === 0 ? 9 : 5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len * u, y);
    ctx.stroke();
    if (p % 20 === 0) label(ctx, String(p), x + (len + 12) * u, y, h, mirrored, { size: 9, align: 'left', bg: 'rgba(7,16,18,0.55)' });
  }
  ctx.restore();
}

export function drawPlumb(ctx: CanvasRenderingContext2D, x: number, w: number, h: number, mirrored: boolean, text: string | null) {
  const u = unit(h);
  const X = x * w;
  ctx.save();
  ctx.strokeStyle = GRID_COLORS.plumb;
  ctx.lineWidth = 1.6 * u;
  ctx.setLineDash([9 * u, 6 * u]);
  ctx.beginPath();
  ctx.moveTo(X, 0);
  ctx.lineTo(X, h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = GRID_COLORS.plumb;
  ctx.beginPath();
  ctx.moveTo(X - 6 * u, h - 22 * u);
  ctx.lineTo(X + 6 * u, h - 22 * u);
  ctx.lineTo(X, h - 8 * u);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (text) label(ctx, text, X, h - 40 * u, h, mirrored, { size: 10, color: GRID_COLORS.plumb });
}

/** A named level line (e.g. "Shoulders 2.1°"): faint full-width reference plus the measured segment. */
export function drawNamedLevel(ctx: CanvasRenderingContext2D, a: Landmark, b: Landmark, w: number, h: number, mirrored: boolean, name: string, value: string) {
  const u = unit(h);
  const A = { x: a.x * w, y: a.y * h };
  const B = { x: b.x * w, y: b.y * h };
  const midY = (A.y + B.y) / 2;
  ctx.save();
  ctx.strokeStyle = GRID_COLORS.reference;
  ctx.lineWidth = 1 * u;
  ctx.setLineDash([6 * u, 5 * u]);
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = GRID_COLORS.level;
  ctx.lineWidth = 2.6 * u;
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.stroke();
  for (const P of [A, B]) {
    ctx.beginPath();
    ctx.arc(P.x, P.y, 4 * u, 0, Math.PI * 2);
    ctx.fillStyle = GRID_COLORS.level;
    ctx.fill();
  }
  ctx.restore();
  // Name just outside one end of the measured segment, value outside the other (clear of the ruler).
  // `label` counter-flips text in the mirrored preview, so these alignments always point away from the line.
  const left = Math.min(A.x, B.x);
  const right = Math.max(A.x, B.x);
  label(ctx, name, left - 10 * u, midY, h, mirrored, { size: 11, align: 'right' });
  label(ctx, value, right + 10 * u, midY, h, mirrored, { size: 12, align: 'left', color: GRID_COLORS.level });
}

/** Side view: horizontal offset from a landmark to the plumb line. */
function drawOffsetTick(ctx: CanvasRenderingContext2D, lm: Landmark, px: number, w: number, h: number, mirrored: boolean, value: string) {
  const u = unit(h);
  const P = { x: lm.x * w, y: lm.y * h };
  const X = px * w;
  ctx.save();
  ctx.strokeStyle = GRID_COLORS.level;
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.moveTo(P.x, P.y);
  ctx.lineTo(X, P.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(P.x, P.y, 4 * u, 0, Math.PI * 2);
  ctx.fillStyle = GRID_COLORS.level;
  ctx.fill();
  ctx.restore();
  // Values sit in a column on the opposite edge from the height ruler.
  ctx.save();
  ctx.strokeStyle = GRID_COLORS.reference;
  ctx.lineWidth = 1 * u;
  ctx.setLineDash([2 * u, 4 * u]);
  ctx.beginPath();
  ctx.moveTo(Math.max(P.x, X), P.y);
  ctx.lineTo(w - 58 * u, P.y);
  ctx.stroke();
  ctx.restore();
  label(ctx, value, w - 30 * u, P.y, h, mirrored, { size: 11, color: GRID_COLORS.level });
}

export interface SceneLabels {
  plumb: string;
  head: string;
  shoulders: string;
  pelvis: string;
  format: (s: Extract<PostureMetricStatus, { state: 'measured' }>) => string;
}

export interface SceneInput {
  lms: Landmark[];
  width: number;
  height: number;
  view: ViewOrientation;
  statuses: PostureMetricStatus[];
  mirrored: boolean;
  support?: number[] | null;
  skeleton?: boolean;
  /** Draw the relative height scale (off for zoomed region panels). */
  ruler?: boolean;
  /** Plumb-line x (0–1) computed from the full frame — used by zoomed panels whose crop hides the ankles. */
  plumbOverride?: number | null;
  /** Label the plumb line (off in small zoomed panels, where it would cover joints). */
  plumbLabel?: boolean;
  labels: SceneLabels;
}

const LEVELS: [PostureMetricId, keyof SceneLabels, number, number][] = [
  ['head_tilt', 'head', LM.rightEar, LM.leftEar],
  ['shoulder_level', 'shoulders', LM.rightShoulder, LM.leftShoulder],
  ['pelvic_level', 'pelvis', LM.rightHip, LM.leftHip],
];

/** Draws the whole posture scene (grid, scale, plumb line, skeleton, measured lines) on a prepared canvas. */
export function drawPostureScene(ctx: CanvasRenderingContext2D, s: SceneInput) {
  const { lms, width: w, height: h, view, mirrored, labels } = s;
  drawGrid(ctx, w, h);
  if (lms.length < 33) return; // no stored landmarks (e.g. older records): grid only, no lines
  if (s.ruler !== false) {
    const scale = heightScale(lms, view, s.support);
    if (scale.ok) drawHeightRuler(ctx, scale.value.ankleY, scale.value.noseY, h, mirrored);
  }
  const found = plumbX(lms, view, s.support);
  const plumb = s.plumbOverride !== undefined ? (s.plumbOverride === null ? null : s.plumbOverride) : found.ok ? found.value : null;
  if (plumb !== null) drawPlumb(ctx, plumb, w, h, mirrored, s.plumbLabel === false ? null : labels.plumb);
  if (s.skeleton !== false) drawSkeleton(ctx, lms, w, h, { mirrored, minVisibility: 0.5, thin: true });
  const measured = new Map(s.statuses.filter((x): x is Extract<PostureMetricStatus, { state: 'measured' }> => x.state === 'measured').map((x) => [x.id, x]));
  if (view === 'anterior' || view === 'posterior') {
    for (const [id, key, a, b] of LEVELS) {
      const m = measured.get(id);
      if (m) drawNamedLevel(ctx, lms[a], lms[b], w, h, mirrored, labels[key] as string, labels.format(m));
    }
  } else if (plumb !== null) {
    const nearSide = view === 'lateral_right' ? 'right' : 'left';
    const pick = (l: number, r: number) => (nearSide === 'left' ? l : r);
    const ticks: [PostureMetricId, number][] = [
      ['plumb_ear_offset', pick(LM.leftEar, LM.rightEar)],
      ['plumb_shoulder_offset', pick(LM.leftShoulder, LM.rightShoulder)],
      ['plumb_hip_offset', pick(LM.leftHip, LM.rightHip)],
      ['plumb_knee_offset', pick(LM.leftKnee, LM.rightKnee)],
    ];
    for (const [id, i] of ticks) {
      const m = measured.get(id);
      if (m) drawOffsetTick(ctx, lms[i], plumb, w, h, mirrored, labels.format(m));
    }
  }
}
