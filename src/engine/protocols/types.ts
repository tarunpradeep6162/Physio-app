import type { ProcessedFrame } from '../pipeline';
import type { Landmark, Side, ViewOrientation } from '../types';
import type { EncodedFrames } from './codec';
import type { Cycle, CycleConfig, CycleDetector } from './cycles';

/**
 * Versioned assessment-test protocols. A protocol states exactly how a test is captured
 * (position, view, required landmarks), how the signal is computed, how movement cycles are
 * segmented, which quality gates must pass, and what the result can and cannot tell you.
 * Results store the protocol + algorithm version so historical captures stay interpretable.
 */

export type ProtocolId = 'knee_supported_flexion' | 'knee_sit_to_stand' | 'knee_squat' | 'shoulder_flexion_active' | 'shoulder_abduction_active';
export type Region = 'knee' | 'shoulder' | 'low_back';

export interface SignalSample {
  value: number | null;
  confidence: number;
  reason?: string;
  /** Secondary per-frame values, e.g. FPPA left/right or trunk lean. */
  extras?: Record<string, number | null>;
  /** Required landmarks that failed validation (indices). */
  missing?: number[];
}

export type SignalFn = (frame: ProcessedFrame) => SignalSample;

export interface MetricSpec {
  id: string;
  label: string;
  unit: 'deg' | 's' | 'count' | 'pct_leg';
  /** Per-side metric (e.g. squat FPPA) or single value. */
  side?: Side;
  method: string;
  /** How to read the sign / meaning, shown next to the value. */
  interpretation?: string;
}

export interface ProtocolMetric extends MetricSpec {
  value: number | null;
  perCycle: number[];
  validity: 'valid' | 'invalid';
  reason?: string;
}

export interface MovementEvent {
  t: number;
  type: 'ready' | 'start' | 'engaged' | 'peak' | 'returning' | 'end' | 'incomplete' | 'discarded' | 'paused' | 'resumed';
  cycle?: number;
}

export interface Keyframe {
  label: 'start' | 'mid' | 'peak' | 'return';
  t: number;
  cycle: number;
  filtered: Landmark[];
  raw: Landmark[] | null;
}

export interface CaptureConfig {
  view: ViewOrientation;
  facing: 'user' | 'environment';
  frameWidth: number;
  frameHeight: number;
  cameraRollDeg: number | null;
  /** Vertical fraction of the frame the body occupies (distance proxy — NOT a metric distance). */
  bodyHeightFrac: number;
  /** Horizontal fraction of the frame the body occupies (distance proxy for lying tests). */
  bodyWidthFrac?: number;
  bodyCenterX: number;
  bodyCenterY: number;
}

export interface ConditionMatch {
  score: number; // 0–1, share of checks that match the baseline
  checks: { id: string; label: string; baseline: string; current: string; match: boolean }[];
}

export interface QualityReport {
  verdict: 'valid' | 'invalid';
  reasons: string[];
  /** Share of recording frames with a valid signal. */
  coverage: number;
  meanConfidence: number | null;
  validCycles: number;
  attemptedCycles: number;
  issues: Record<string, number>;
  meanFps: number | null;
}

export interface ProtocolResult {
  protocolId: ProtocolId;
  protocolVersion: string;
  algorithmVersion: string;
  side: Side | null;
  view: ViewOrientation;
  durationSec: number;
  frameWidth: number;
  frameHeight: number;
  cycles: Cycle[];
  metrics: ProtocolMetric[];
  quality: QualityReport;
  /** Filtered primary signal at 10 Hz (seconds, value). */
  signal: { t: number; v: number | null }[];
  events: MovementEvent[];
  keyframes: Keyframe[];
  frames: EncodedFrames;
  /** Exact signal processing used (provenance; absent on pv-knee-1.0.0 results). */
  processing?: SignalProcessing;
}

export interface SignalProcessing {
  coordinateFilter: string;
  liveAngleFilter: string;
  guard: { maxRatePerSec: number; recoverMs: number; gapMs: number };
  stored: string;
}

export interface Recording {
  samples: {
    t: number;
    /** Signal as computed from landmarks. */
    raw: number | null;
    /** After the plausibility guard (null for rejected / recovering samples). */
    guarded?: number | null;
    /** Live causal-filtered value (what the patient saw). */
    live?: number | null;
    /** Analysed value: live during capture; replaced by the zero-phase series at finish. */
    value: number | null;
    confidence: number;
    reason?: string;
    extras?: Record<string, number | null>;
    missing?: number[];
  }[];
  detector: CycleDetector;
  events: MovementEvent[];
  fps: number | null;
}

export interface ProtocolDef {
  id: ProtocolId;
  version: string;
  /** Calculation version stamped on results (defaults to the knee algorithm for knee protocols). */
  algorithmVersion?: string;
  region: Region;
  title: string;
  shortTitle: string;
  purpose: string;
  position: 'supine' | 'seated_to_standing' | 'standing';
  /** Whether the result belongs to one side (captured once per side) or both sides at once. */
  sided: boolean;
  views: (side: Side | null) => ViewOrientation[];
  requiredLandmarks: (side: Side | null) => number[];
  setup: string[];
  cueStart: string;
  targetCycles: number;
  maxDurationSec: number;
  cycle: CycleConfig;
  /** Primary signal label shown live, e.g. "Knee flexion". */
  signalLabel: string;
  signalUnit: 'deg' | 'pct_leg';
  createSignal: (side: Side | null) => SignalFn;
  /** Recording ends when this returns true (checked after every frame). */
  isComplete: (detector: CycleDetector) => boolean;
  closeAcceptsEngaged: boolean;
  analyze: (rec: Recording, side: Side | null) => ProtocolMetric[];
  quality: { minCoverage: number; minMeanConfidence: number; minValidCycles: number };
  limitations: string[];
  references: string[];
  /**
   * Camera framing rules (from v1.1.0). Distance is judged on the body region THIS test needs —
   * e.g. the leg for a heel slide — never on standing full-body rules.
   */
  framing?: ProtocolFraming;
  /** Setup guidance shown before capture, with an illustrated unobstructed example. */
  guide?: ProtocolGuide;
  /** What changed in this version (clinician-readable). */
  changes?: string[];
}

export interface ProtocolFraming {
  /** Axis along which the region's extent is judged. */
  axis: 'vertical' | 'horizontal';
  /** Landmarks whose extent is the distance proxy. */
  extentLandmarks: (side: Side | null) => number[];
  /** Acceptable extent as a fraction of the frame along `axis`. */
  range: [number, number];
  /** Recommended phone orientation. */
  orientation: 'portrait' | 'landscape';
  maxRollDeg: number;
  minConfidence: number;
}

export interface ProtocolGuide {
  camera: string;
  distance: string;
  view: string;
  region: string;
  lighting: string;
  clothing: string;
  /** Start pose shown in the illustration (synthetic skeleton, rendered as a figure). */
  example: (side: Side | null) => import('../pose/synthetic').SynthScene;
}
