import { SKELETON_JOINTS, SKELETON_SEGMENTS } from '../engine/landmarks';
import type { Landmark } from '../engine/types';

/**
 * Canvas overlay renderer. The canvas uses the camera frame's pixel size and the same
 * `object-fit: cover` as the video, so landmark coordinates map 1:1. When the view is mirrored
 * (front camera) the whole stage is flipped with CSS; text is counter-flipped here so it reads
 * correctly.
 *
 * Visual states never rely on colour alone: low-confidence segments are dashed and joints
 * hollow; target-reached arcs are filled; attention states use a double ring.
 */

export type OverlayState = 'tracked' | 'low' | 'target' | 'attention';

export const OVERLAY_COLORS = {
  tracked: 'rgba(236, 253, 250, 0.92)',
  bone: 'rgba(34, 211, 197, 0.9)',
  low: 'rgba(160, 174, 172, 0.55)',
  target: '#31C48D',
  attention: '#F59E0B',
  error: '#E65A5A',
  guide: 'rgba(34, 211, 197, 0.85)',
  guideSoft: 'rgba(236, 253, 250, 0.35)',
  raw: 'rgba(245, 158, 11, 0.85)',
};

export interface DrawOptions {
  mirrored: boolean;
  minVisibility?: number;
  /** Landmarks belonging to the measured joint chain (drawn emphasised). */
  focus?: number[];
  state?: OverlayState;
  color?: string;
  jointRadius?: number;
  thin?: boolean;
}

export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx?.clearRect(0, 0, width, height);
  return ctx;
}

function unit(h: number) {
  return Math.max(1.5, h / 360);
}

export function drawSkeleton(ctx: CanvasRenderingContext2D, lms: Landmark[], w: number, h: number, o: DrawOptions) {
  const u = unit(h);
  const minV = o.minVisibility ?? 0.5;
  const focus = new Set(o.focus ?? []);
  const P = (i: number) => ({ x: lms[i].x * w, y: lms[i].y * h, v: lms[i].visibility });
  ctx.lineCap = 'round';
  for (const [a, b] of SKELETON_SEGMENTS) {
    const pa = P(a);
    const pb = P(b);
    const ok = pa.v >= minV && pb.v >= minV;
    const isFocus = focus.has(a) && focus.has(b);
    ctx.setLineDash(ok ? [] : [4 * u, 4 * u]);
    ctx.strokeStyle = o.color ?? (!ok ? OVERLAY_COLORS.low : isFocus ? stateColor(o.state) : OVERLAY_COLORS.bone);
    ctx.lineWidth = (isFocus ? 3.2 : o.thin ? 1.2 : 2) * u;
    ctx.globalAlpha = ok ? 1 : 0.7;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  for (const i of SKELETON_JOINTS) {
    const p = P(i);
    const ok = p.v >= minV;
    const r = (focus.has(i) ? 5 : o.jointRadius ?? 3.2) * u;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (ok) {
      ctx.fillStyle = o.color ?? (focus.has(i) ? stateColor(o.state) : OVERLAY_COLORS.tracked);
      ctx.fill();
      ctx.lineWidth = 1.2 * u;
      ctx.strokeStyle = 'rgba(7,16,18,0.7)';
      ctx.stroke();
    } else {
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = OVERLAY_COLORS.low;
      ctx.stroke();
    }
    if (focus.has(i) && o.state === 'attention') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4 * u, 0, Math.PI * 2);
      ctx.strokeStyle = OVERLAY_COLORS.attention;
      ctx.lineWidth = 1.5 * u;
      ctx.stroke();
    }
  }
}

export function stateColor(s: OverlayState | undefined): string {
  switch (s) {
    case 'target':
      return OVERLAY_COLORS.target;
    case 'attention':
      return OVERLAY_COLORS.attention;
    case 'low':
      return OVERLAY_COLORS.low;
    default:
      return OVERLAY_COLORS.guide;
  }
}

/** Draws text that stays readable when the canvas is mirrored via CSS. */
export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, h: number, mirrored: boolean, opts: { color?: string; bg?: string; size?: number; align?: CanvasTextAlign; border?: string } = {}) {
  const u = unit(h);
  ctx.save();
  ctx.translate(x, y);
  if (mirrored) ctx.scale(-1, 1);
  ctx.font = `600 ${(opts.size ?? 13) * u}px Inter, system-ui, sans-serif`;
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  const m = ctx.measureText(text);
  const pw = 6 * u;
  const bw = m.width + pw * 2;
  const bh = (opts.size ?? 13) * u * 1.7;
  const bx = opts.align === 'left' ? -pw : opts.align === 'right' ? -m.width - pw : -bw / 2;
  ctx.fillStyle = opts.bg ?? 'rgba(7,16,18,0.78)';
  ctx.beginPath();
  ctx.roundRect(bx, -bh / 2, bw, bh, 4 * u);
  ctx.fill();
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = 1.5 * u;
    ctx.stroke();
  }
  ctx.fillStyle = opts.color ?? '#ECFDFA';
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

/** Angle arc at vertex b between rays b→a and b→c, with an optional label. */
export function drawAngleArc(ctx: CanvasRenderingContext2D, a: Landmark, b: Landmark, c: Landmark, w: number, h: number, text: string | null, mirrored: boolean, state: OverlayState = 'tracked') {
  const u = unit(h);
  const B = { x: b.x * w, y: b.y * h };
  const a1 = Math.atan2(a.y * h - B.y, a.x * w - B.x);
  const a2 = Math.atan2(c.y * h - B.y, c.x * w - B.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const r = 26 * u;
  ctx.beginPath();
  ctx.moveTo(B.x, B.y);
  ctx.arc(B.x, B.y, r, a1, a1 + d, d < 0);
  ctx.closePath();
  ctx.fillStyle = state === 'target' ? 'rgba(49,196,141,0.35)' : 'rgba(34,211,197,0.18)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(B.x, B.y, r, a1, a1 + d, d < 0);
  ctx.strokeStyle = stateColor(state);
  ctx.lineWidth = 2 * u;
  ctx.stroke();
  if (text) {
    const mid = a1 + d / 2;
    label(ctx, text, B.x - Math.cos(mid) * (r + 30 * u), B.y - Math.sin(mid) * (r + 30 * u), h, mirrored, { size: 14 });
  }
}

export function drawPlumbLine(ctx: CanvasRenderingContext2D, x: number, w: number, h: number) {
  const u = unit(h);
  const X = x * w;
  ctx.save();
  ctx.strokeStyle = OVERLAY_COLORS.guide;
  ctx.lineWidth = 1.5 * u;
  ctx.setLineDash([8 * u, 6 * u]);
  ctx.beginPath();
  ctx.moveTo(X, 0);
  ctx.lineTo(X, h);
  ctx.stroke();
  ctx.setLineDash([]);
  // Plumb bob
  ctx.fillStyle = OVERLAY_COLORS.guide;
  ctx.beginPath();
  ctx.moveTo(X - 6 * u, h - 22 * u);
  ctx.lineTo(X + 6 * u, h - 22 * u);
  ctx.lineTo(X, h - 8 * u);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawLevelLine(ctx: CanvasRenderingContext2D, a: Landmark, b: Landmark, w: number, h: number, text: string | null, mirrored: boolean, state: OverlayState = 'tracked') {
  const u = unit(h);
  const A = { x: a.x * w, y: a.y * h };
  const B = { x: b.x * w, y: b.y * h };
  const midY = (A.y + B.y) / 2;
  ctx.save();
  // Horizontal reference
  ctx.strokeStyle = OVERLAY_COLORS.guideSoft;
  ctx.lineWidth = 1 * u;
  ctx.setLineDash([5 * u, 5 * u]);
  ctx.beginPath();
  ctx.moveTo(Math.min(A.x, B.x) - 40 * u, midY);
  ctx.lineTo(Math.max(A.x, B.x) + 40 * u, midY);
  ctx.stroke();
  ctx.setLineDash([]);
  // Measured line
  ctx.strokeStyle = stateColor(state);
  ctx.lineWidth = 2.2 * u;
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.stroke();
  ctx.restore();
  if (text) label(ctx, text, Math.max(A.x, B.x) + 52 * u, midY, h, mirrored, { size: 12 });
}

/** Alignment frame shown during calibration. */
export function drawAlignmentFrame(ctx: CanvasRenderingContext2D, w: number, h: number, ready: boolean, progress: number) {
  const u = unit(h);
  const fw = Math.min(w * 0.62, h * 0.5);
  const fh = h * 0.9;
  const x = (w - fw) / 2;
  const y = (h - fh) / 2;
  const len = 28 * u;
  ctx.save();
  ctx.strokeStyle = ready ? OVERLAY_COLORS.target : 'rgba(236,253,250,0.75)';
  ctx.lineWidth = 3 * u;
  const corners: [number, number, number, number][] = [
    [x, y, 1, 1],
    [x + fw, y, -1, 1],
    [x, y + fh, 1, -1],
    [x + fw, y + fh, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * len, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * len);
    ctx.stroke();
  }
  if (progress > 0 && progress < 1) {
    ctx.strokeStyle = OVERLAY_COLORS.target;
    ctx.lineWidth = 4 * u;
    ctx.beginPath();
    ctx.moveTo(x, y + fh + 10 * u);
    ctx.lineTo(x + fw * progress, y + fh + 10 * u);
    ctx.stroke();
  }
  ctx.restore();
}
