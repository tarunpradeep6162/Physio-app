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

export type ProtocolId = 'knee_supported_flexion' | 'knee_sit_to_stand' | 'knee_squat';
export type Region = 'knee' | 'shoulder' | 'low_back';

export interface SignalSample {
  value: number | null;
  confidence: number;
  reason?: string;
  /** Secondary per-frame values, e.g. FPPA left/right or trunk lean. */
  extras?: Record<string, number | null>;
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
}

export interface Recording {
  samples: { t: number; raw: number | null; value: number | null; confidence: number; reason?: string; extras?: Record<string, number | null> }[];
  detector: CycleDetector;
  events: MovementEvent[];
  fps: number | null;
}

export interface ProtocolDef {
  id: ProtocolId;
  version: string;
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
}
