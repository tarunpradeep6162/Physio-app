import type { PoseFrame, PoseProviderInfo } from '../types';

/**
 * Provider abstraction. The application depends only on this interface, never on a specific
 * model, so MediaPipe Pose can be swapped for MoveNet, a native SDK or a validated clinical
 * model without touching the biomechanics, state machine or UI.
 */
export interface PoseProvider {
  readonly info: PoseProviderInfo;
  /** Loads model weights / runtime. Idempotent. */
  init(): Promise<void>;
  /**
   * Runs inference on the current video frame. Must be called with monotonically increasing
   * timestamps (ms).
   */
  detect(source: HTMLVideoElement, timestamp: number): PoseFrame;
  close(): void;
}

export type PoseProviderId = 'mediapipe-lite' | 'mediapipe-full' | 'simulated';

export interface ProviderOptions {
  /** Detect up to this many people so that "multiple people" can be reported instead of guessed. */
  maxPoses?: number;
  delegate?: 'GPU' | 'CPU';
}

/** Lazily constructs a provider so the pose runtime is only downloaded when the camera opens. */
export async function createPoseProvider(id: PoseProviderId, opts: ProviderOptions = {}): Promise<PoseProvider> {
  if (id === 'simulated') {
    const { SimulatedPoseProvider } = await import('./simulated');
    return new SimulatedPoseProvider();
  }
  const { MediaPipePoseProvider } = await import('./mediapipe');
  return new MediaPipePoseProvider(id === 'mediapipe-full' ? 'full' : 'lite', opts);
}
