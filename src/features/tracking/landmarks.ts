/**
 * Pose landmark model (33 points, BlazePose topology used by MediaPipe).
 *
 * All poses inside the app live in MIRRORED FRAME UNITS:
 *   x ∈ [0, aspect]  — mirrored, so the user's anatomical LEFT side is on screen LEFT
 *   y ∈ [0, 1]       — 1 unit = frame height, grows downward
 * Using frame height for both axes keeps distances isotropic (no aspect skew).
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** Visibility / confidence 0..1 */
  v: number;
}

export type Pose = Landmark[];

export const POSE_LANDMARK_COUNT = 33;

export const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

/** Bones drawn for the skeleton (face details intentionally omitted). */
export const SKELETON_BONES: ReadonlyArray<readonly [number, number]> = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.LEFT_WRIST, LM.LEFT_INDEX],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.RIGHT_WRIST, LM.RIGHT_INDEX],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
];

/** Joints rendered as dots. */
export const SKELETON_JOINTS: readonly number[] = [
  LM.LEFT_SHOULDER,
  LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW,
  LM.RIGHT_ELBOW,
  LM.LEFT_WRIST,
  LM.RIGHT_WRIST,
  LM.LEFT_HIP,
  LM.RIGHT_HIP,
  LM.LEFT_KNEE,
  LM.RIGHT_KNEE,
  LM.LEFT_ANKLE,
  LM.RIGHT_ANKLE,
];

export type BodyPart = 'head' | 'shoulders' | 'torso' | 'leftArm' | 'rightArm' | 'hips' | 'legs';

export const BODY_PART_JOINTS: Record<BodyPart, readonly number[]> = {
  head: [LM.NOSE, LM.LEFT_EYE, LM.RIGHT_EYE, LM.LEFT_EAR, LM.RIGHT_EAR],
  shoulders: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  torso: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP],
  leftArm: [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.LEFT_INDEX],
  rightArm: [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST, LM.RIGHT_INDEX],
  hips: [LM.LEFT_HIP, LM.RIGHT_HIP],
  legs: [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
};

/** Upper-body landmark indices: everything above the hips (face, shoulders, arms, hands). */
export const UPPER_BODY_MAX_INDEX = LM.RIGHT_THUMB;

export function createPose(): Pose {
  const pose: Pose = [];
  for (let i = 0; i < POSE_LANDMARK_COUNT; i++) pose.push({ x: 0, y: 0, z: 0, v: 0 });
  return pose;
}

export function clonePose(pose: Pose): Pose {
  return pose.map((p) => ({ x: p.x, y: p.y, z: p.z, v: p.v }));
}

export function copyPoseInto(source: Pose, target: Pose): Pose {
  for (let i = 0; i < source.length; i++) {
    const s = source[i];
    const t = target[i];
    if (!s || !t) continue;
    t.x = s.x;
    t.y = s.y;
    t.z = s.z;
    t.v = s.v;
  }
  return target;
}

/** Safe accessor — the pose array always has 33 entries, this keeps TS strict mode honest. */
export function lm(pose: Pose, index: number): Landmark {
  const point = pose[index];
  if (!point) throw new Error(`Landmark ${index} missing`);
  return point;
}
