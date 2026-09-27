import type { Side } from './types';

/**
 * BlazePose 33-landmark topology (used by MediaPipe Pose). Other providers (e.g. MoveNet's
 * 17 COCO keypoints) are mapped onto these indices by their adapter so that the biomechanics
 * layer never depends on a specific model.
 */
export const LM = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export type LandmarkName = keyof typeof LM;
export const LANDMARK_COUNT = 33;

export const LANDMARK_NAMES: LandmarkName[] = Object.keys(LM) as LandmarkName[];

export type Joint = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle' | 'heel' | 'foot' | 'ear' | 'eye';

const SIDE_INDEX: Record<Joint, Record<Side, number>> = {
  shoulder: { left: LM.leftShoulder, right: LM.rightShoulder },
  elbow: { left: LM.leftElbow, right: LM.rightElbow },
  wrist: { left: LM.leftWrist, right: LM.rightWrist },
  hip: { left: LM.leftHip, right: LM.rightHip },
  knee: { left: LM.leftKnee, right: LM.rightKnee },
  ankle: { left: LM.leftAnkle, right: LM.rightAnkle },
  heel: { left: LM.leftHeel, right: LM.rightHeel },
  foot: { left: LM.leftFootIndex, right: LM.rightFootIndex },
  ear: { left: LM.leftEar, right: LM.rightEar },
  eye: { left: LM.leftEye, right: LM.rightEye },
};

export function idx(joint: Joint, side: Side): number {
  return SIDE_INDEX[joint][side];
}

/** Skeleton segments drawn by the overlay (face mesh points intentionally omitted for a clean look). */
export const SKELETON_SEGMENTS: [number, number][] = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
  [LM.leftAnkle, LM.leftHeel],
  [LM.leftHeel, LM.leftFootIndex],
  [LM.leftAnkle, LM.leftFootIndex],
  [LM.rightAnkle, LM.rightHeel],
  [LM.rightHeel, LM.rightFootIndex],
  [LM.rightAnkle, LM.rightFootIndex],
];

/** Landmarks drawn as joints on the overlay. */
export const SKELETON_JOINTS: number[] = [
  LM.nose,
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
  LM.leftHeel,
  LM.rightHeel,
  LM.leftFootIndex,
  LM.rightFootIndex,
];

/** Landmarks that must be in frame for a whole-body posture scan. */
export const FULL_BODY_LANDMARKS: number[] = [
  LM.nose,
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
];
