/**
 * Core types for the PhysioVision Motion Intelligence Engine.
 *
 * The engine is pure TypeScript with no React or DOM dependency so it can be unit-tested,
 * run in a worker, and reused by both the patient and clinician experiences.
 */

/** A single landmark in normalised image coordinates (x, y in [0,1]; z relative depth). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** Model-reported likelihood (0–1) that the landmark is visible / not occluded. */
  visibility: number;
}

/** Output of one pose-estimation pass over one camera frame. */
export interface PoseFrame {
  /** Monotonic timestamp in milliseconds. */
  timestamp: number;
  /** Frame dimensions in pixels (needed to correct for non-square aspect ratios). */
  width: number;
  height: number;
  /** One landmark array per detected person (BlazePose 33-point topology). */
  poses: Landmark[][];
  /** Optional metric 3D landmarks (hip-centred, metres) for the primary person. */
  worldLandmarks?: Landmark[];
  /** Wall time spent inside the pose model for this frame. */
  inferenceMs: number;
  /** Identifies the provider that produced the frame (for provenance). */
  provider: PoseProviderInfo;
}

export interface PoseProviderInfo {
  id: string;
  model: string;
  version: string;
  /** True when frames are synthetic (demo / test). Must be surfaced in the UI. */
  simulated: boolean;
  /** Runtime configuration actually in effect (delegate after any fallback, thresholds). */
  config?: { delegate?: 'GPU' | 'CPU'; numPoses?: number; minDetection?: number; minPresence?: number; minTracking?: number; thread?: 'main' | 'worker' };
}

export type Side = 'left' | 'right';

export type ViewOrientation = 'anterior' | 'posterior' | 'lateral_left' | 'lateral_right' | 'unknown';

export type ConfidenceLevel = 'high' | 'moderate' | 'low' | 'insufficient';

/**
 * A camera-estimated value. `value` is null when the engine refuses to compute a number
 * (tracking lost, occlusion, low confidence) — the UI must never fabricate one.
 */
export interface Estimate {
  value: number | null;
  /** 0–1 confidence combining landmark visibility and (where relevant) temporal stability. */
  confidence: number;
  level: ConfidenceLevel;
  /** Human-readable reason when value is null or confidence is reduced. */
  reason?: string;
}

export function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.85) return 'high';
  if (c >= 0.7) return 'moderate';
  if (c >= 0.5) return 'low';
  return 'insufficient';
}
