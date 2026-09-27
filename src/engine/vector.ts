/**
 * Reusable vector mathematics for biomechanical calculation.
 *
 * All 2D calculations operate in PIXEL space: normalised landmarks are scaled by the frame
 * width and height first. Computing angles directly in normalised space would distort every
 * angle on non-square frames (e.g. a 16:9 webcam or a 9:16 phone in portrait).
 */

export interface Vec2 {
  x: number;
  y: number;
}
export interface Vec3 extends Vec2 {
  z: number;
}

export const RAD2DEG = 180 / Math.PI;

export function toPixels(p: { x: number; y: number }, width: number, height: number): Vec2 {
  return { x: p.x * width, y: p.y * height };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}
export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function norm(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}
export function norm3(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}
export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
export function distance(a: Vec2, b: Vec2): number {
  return norm(sub(a, b));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Minimum segment length (px) below which an angle is geometrically meaningless. */
export const MIN_SEGMENT_PX = 4;

/**
 * Interior angle A-B-C at vertex B, in degrees (0–180).
 *
 *   BA = A − B, BC = C − B
 *   angle = acos( (BA · BC) / (|BA| × |BC|) )
 *
 * Returns null for degenerate (near-zero-length) segments instead of a misleading number.
 */
export function jointAngle(a: Vec2, b: Vec2, c: Vec2): number | null {
  const ba = sub(a, b);
  const bc = sub(c, b);
  const nBA = norm(ba);
  const nBC = norm(bc);
  if (nBA < MIN_SEGMENT_PX || nBC < MIN_SEGMENT_PX) return null;
  const cos = clamp(dot(ba, bc) / (nBA * nBC), -1, 1);
  return Math.acos(cos) * RAD2DEG;
}

/** 3D variant of {@link jointAngle}, for metric world landmarks. */
export function jointAngle3(a: Vec3, b: Vec3, c: Vec3, minLen = 1e-3): number | null {
  const ba = sub3(a, b);
  const bc = sub3(c, b);
  const nBA = norm3(ba);
  const nBC = norm3(bc);
  if (nBA < minLen || nBC < minLen) return null;
  const cos = clamp(dot3(ba, bc) / (nBA * nBC), -1, 1);
  return Math.acos(cos) * RAD2DEG;
}

/** Unsigned angle (0–180°) between two direction vectors. */
export function angleBetween(u: Vec2, v: Vec2): number | null {
  const nu = norm(u);
  const nv = norm(v);
  if (nu < MIN_SEGMENT_PX || nv < MIN_SEGMENT_PX) return null;
  return Math.acos(clamp(dot(u, v) / (nu * nv), -1, 1)) * RAD2DEG;
}

/**
 * Signed tilt of the line from `a` to `b` relative to image horizontal, in degrees, folded to
 * (−90, 90]. Positive means `b` is higher in the image than `a` (image y grows downward).
 */
export function tiltFromHorizontal(a: Vec2, b: Vec2): number | null {
  const d = sub(b, a);
  if (norm(d) < MIN_SEGMENT_PX) return null;
  let deg = Math.atan2(-d.y, d.x) * RAD2DEG; // flip y so "up" is positive
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  return deg;
}

/**
 * Signed deviation of the line from `lower` to `upper` relative to image vertical, in degrees.
 * Positive means `upper` lies to the image-right of `lower`.
 */
export function deviationFromVertical(lower: Vec2, upper: Vec2): number | null {
  const d = sub(upper, lower);
  if (norm(d) < MIN_SEGMENT_PX) return null;
  return Math.atan2(d.x, -d.y) * RAD2DEG;
}
