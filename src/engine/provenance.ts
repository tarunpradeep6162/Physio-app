import { MEASUREMENT_ALGORITHM_VERSION } from './measurements';
import type { PoseProviderInfo } from './types';

/**
 * Provenance travels with every stored measurement: who, when, how, from which model and
 * algorithm version, with what confidence and on what device. This is what makes later clinical
 * validation (and re-interpretation after algorithm changes) possible.
 */

export const ENGINE_VERSION = 'physiovision-engine-0.1.0';

export type MeasurementSource =
  | 'camera_estimation'
  | 'clinician_goniometer'
  | 'clinician_entry'
  | 'patient_reported'
  | 'simulated_demo';

export interface DeviceContext {
  userAgent: string;
  platform: string;
  videoWidth: number;
  videoHeight: number;
  facingMode: 'user' | 'environment';
  cameraRollDeg: number | null;
  meanFps: number | null;
  meanInferenceMs: number | null;
  /** Whether the on-screen preview was mirrored (front camera). Inference always sees un-mirrored frames. */
  displayMirrored?: boolean;
  /** Where inference ran, and the camera's delivered frame rate / resolution settings. */
  inferenceThread?: 'worker' | 'main' | null;
  cameraFrameRate?: number | null;
}

export interface Provenance {
  source: MeasurementSource;
  createdBy: string;
  createdAt: string;
  engineVersion: string;
  algorithmVersion: string;
  poseModel?: string;
  poseModelVersion?: string;
  poseProvider?: string;
  exerciseDefinition?: string;
  exerciseDefinitionVersion?: string;
  filter?: string;
  view?: string;
  confidence?: number;
  device?: DeviceContext;
}

export function cameraProvenance(args: {
  createdBy: string;
  provider: PoseProviderInfo;
  confidence: number;
  filter: string;
  view?: string;
  device?: DeviceContext;
  exercise?: { id: string; version: string };
}): Provenance {
  return {
    source: args.provider.simulated ? 'simulated_demo' : 'camera_estimation',
    createdBy: args.createdBy,
    createdAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    algorithmVersion: MEASUREMENT_ALGORITHM_VERSION,
    poseModel: args.provider.model,
    poseModelVersion: args.provider.version,
    poseProvider: args.provider.id,
    exerciseDefinition: args.exercise?.id,
    exerciseDefinitionVersion: args.exercise?.version,
    filter: args.filter,
    view: args.view,
    confidence: Math.round(args.confidence * 1000) / 1000,
    device: args.device,
  };
}
