import { LM } from '../engine/landmarks';
import type { PostureMetricId, PostureMetricStatus } from '../engine/posture';
import { heightScale, plumbX, type Box, type PostureRegion } from '../engine/postureGeometry';
import type { Landmark, ViewOrientation } from '../engine/types';
import { drawSkeleton, label } from './overlay';

/**
 * Clinical posture grid: reference grid, relative height scale, plumb line and named level lines.
 * Only measured metrics get a line and a number; a withheld metric draws nothing on the body (the
 * HUD states why). The height scale is relative (ankle = 0, nose = 100), never centimetres.
 */

const unit = (h: number) => Math.max(1.5, h / 360);

/**
 * Screen-side layout. The front-camera preview is mirrored with CSS, so "the left edge of the
 * screen" is the right edge of the canvas. These helpers place the ruler and name chips on the
 * screen's left and the value chips on its right in both cases (`label` counter-flips the text).
 */
const screenX = (x: number, w: number, mirrored: boolean) => (mirrored ? w - x : x);
const toward = (dir: 'right' | 'left', mirrored: boolean): CanvasTextAlign => (dir === 'right' ? (mirrored ? 'right' : 'left') : mirrored ? 'left' : 'right');

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

/** Relative height ruler on the screen's left edge: 0 at the ankles, 100 at the nose (legend is in the HUD). */
export function drawHeightRuler(ctx: CanvasRenderingContext2D, ankleY: number, noseY: number, w: number, h: number, mirrored: boolean) {
  const u = unit(h);
  const x = screenX(30 * u, w, mirrored);
  const d = mirrored ? -1 : 1;
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
    ctx.lineTo(x + d * len * u, y);
    ctx.stroke();
    // Numbers sit outside the ruler (towards the screen edge), clear of the name chips.
    if (p % 20 === 0) label(ctx, String(p), x - d * 5 * u, y, h, mirrored, { size: 9, align: toward('left', mirrored), bg: 'rgba(7,16,18,0.55)' });
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
  // HUD layout: name chip beside the ruler on the screen's left, boxed value chip on its right edge.
  label(ctx, name, screenX(46 * u, w, mirrored), midY, h, mirrored, { size: 11, align: toward('right', mirrored), bg: 'rgba(12,40,48,0.92)', border: 'rgba(120,200,230,0.55)' });
  label(ctx, value, screenX(w - 10 * u, w, mirrored), midY, h, mirrored, { size: 12, align: toward('left', mirrored), color: GRID_COLORS.level, bg: 'rgba(7,16,18,0.9)', border: GRID_COLORS.level });
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
  ctx.moveTo(P.x, P.y);
  ctx.lineTo(screenX(w - 60 * u, w, mirrored), P.y);
  ctx.stroke();
  ctx.restore();
  label(ctx, value, screenX(w - 10 * u, w, mirrored), P.y, h, mirrored, { size: 11, align: toward('left', mirrored), color: GRID_COLORS.level, bg: 'rgba(7,16,18,0.9)', border: GRID_COLORS.level });
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
    if (scale.ok) drawHeightRuler(ctx, scale.value.ankleY, scale.value.noseY, w, h, mirrored);
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

/**
 * Camera image tone (display only). "grey" = high-contrast blue-grey; "negative" = the same with
 * light and dark swapped (the look of the reference screenshots). Both are filters on the camera
 * picture of the body SURFACE — nothing inside the body is captured, so neither is an X-ray.
 */
export type ImageTone = 'colour' | 'grey' | 'negative';
export const TONE_FILTER: Record<ImageTone, string> = {
  colour: 'none',
  grey: 'grayscale(1) sepia(0.35) hue-rotate(160deg) saturate(1.6) contrast(1.7) brightness(0.72)',
  negative: 'grayscale(1) invert(1) sepia(0.25) hue-rotate(160deg) saturate(1.4) contrast(1.45) brightness(0.78)',
};

/**
 * Privacy: covers the face with an opaque disc centred on the nose, sized from the ear/eye spread.
 * Drawn only when the nose is detected; otherwise nothing is guessed.
 */
export function drawFaceCover(ctx: CanvasRenderingContext2D, lms: Landmark[], w: number, h: number) {
  const nose = lms[LM.nose];
  if (!nose || nose.visibility < 0.3) return;
  const pts = [LM.leftEar, LM.rightEar, LM.leftEye, LM.rightEye].map((i) => lms[i]).filter((l) => l && l.visibility >= 0.3);
  const spread = pts.length ? Math.max(...pts.map((l) => Math.hypot((l.x - nose.x) * w, (l.y - nose.y) * h))) : 0.05 * h;
  const r = Math.max(spread * 1.55, 0.035 * h);
  ctx.save();
  ctx.fillStyle = '#1b3a40';
  ctx.strokeStyle = '#8fb0aa';
  ctx.lineWidth = Math.max(1.5, h / 360);
  ctx.beginPath();
  ctx.arc(nose.x * w, nose.y * h - r * 0.12, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Dashed outline around the area the PATIENT marked on the pain map (a report, not a finding). */
export function drawReportedArea(ctx: CanvasRenderingContext2D, b: Box, w: number, h: number, mirrored: boolean, text: string) {
  const u = unit(h);
  ctx.save();
  ctx.strokeStyle = '#C4A5FF';
  ctx.lineWidth = 2 * u;
  ctx.setLineDash([7 * u, 5 * u]);
  ctx.beginPath();
  ctx.roundRect(b.x * w, b.y * h, b.w * w, b.h * h, 10 * u);
  ctx.stroke();
  ctx.restore();
  const cx = (b.x + b.w / 2) * w;
  label(ctx, text, cx, Math.max(12 * u, b.y * h + 12 * u), h, mirrored, { size: 10, color: '#E6D9FF', bg: 'rgba(40,20,70,0.85)', border: '#C4A5FF' });
}

export interface RegionPanelInput {
  /** The camera frame (video) or a stored still; null draws landmarks on the grid only. */
  source: CanvasImageSource | null;
  sourceW: number;
  sourceH: number;
  lms: Landmark[];
  view: ViewOrientation;
  statuses: PostureMetricStatus[];
  /** Crop in normalised frame coordinates; null = full frame. */
  box: Box | null;
  region: PostureRegion | null;
  width: number;
  height: number;
  mirrored: boolean;
  tone?: ImageTone;
  coverFace?: boolean;
  support?: number[] | null;
  labels: SceneLabels;
}

/** One zoomed panel (live or captured): crop of the single camera frame, re-mapped landmarks, grid and lines. */
export function drawRegionPanel(ctx: CanvasRenderingContext2D, p: RegionPanelInput) {
  const b = p.box ?? { x: 0, y: 0, w: 1, h: 1 };
  ctx.fillStyle = '#0b1a1f';
  ctx.fillRect(0, 0, p.width, p.height);
  if (p.source && p.sourceW > 0) {
    ctx.save();
    if (p.tone && p.tone !== 'colour') ctx.filter = TONE_FILTER[p.tone];
    ctx.globalAlpha = 0.85;
    ctx.drawImage(p.source, b.x * p.sourceW, b.y * p.sourceH, b.w * p.sourceW, b.h * p.sourceH, 0, 0, p.width, p.height);
    ctx.restore();
  }
  const remap = p.lms.map((l) => ({ ...l, x: (l.x - b.x) / b.w, y: (l.y - b.y) / b.h }));
  if (p.coverFace && p.source && remap.length >= 33) drawFaceCover(ctx, remap, p.width, p.height);
  const full = p.lms.length >= 33 ? plumbX(p.lms, p.view, p.support) : ({ ok: false } as const);
  drawPostureScene(ctx, {
    lms: remap,
    width: p.width,
    height: p.height,
    view: p.view,
    statuses: p.statuses,
    mirrored: p.mirrored,
    ruler: p.region === null || p.region === 'full_body',
    plumbOverride: full.ok ? (full.value - b.x) / b.w : null,
    plumbLabel: p.region === null,
    labels: p.labels,
  });
}
