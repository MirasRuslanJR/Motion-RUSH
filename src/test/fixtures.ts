import { Calibrator, type Baseline } from '../features/gestures/calibration';
import { extractFeatures, extractGeometry, type BodyFeatures } from '../features/gestures/FeatureExtractor';
import { classify, type Classification } from '../features/gestures/GestureClassifier';
import type { Pose } from '../features/tracking/landmarks';
import { buildSyntheticPose, type SyntheticPoseParams } from '../features/tracking/syntheticPose';

/** 4:3 camera, player centred, ~2 m away. */
export const ASPECT = 4 / 3;
const BASE = { cx: ASPECT / 2, cy: 0.42, sw: 0.16 } as const;

export function makePose(params: Partial<SyntheticPoseParams> = {}): Pose {
  return buildSyntheticPose({ ...BASE, ...params });
}

/** Runs the real Calibrator on ~2.4 s of still neutral frames. */
export function calibrate(lowerBodyVisible = true): Baseline {
  const calibrator = new Calibrator();
  const neutral = extractGeometry(makePose({ lowerBodyVisible }));
  for (let t = 0; t <= 2600; t += 33) {
    const res = calibrator.push(neutral, true, t);
    if (res.done) break;
  }
  const baseline = calibrator.baseline;
  if (!baseline) throw new Error('calibration did not finish');
  return baseline;
}

export interface Analysed {
  pose: Pose;
  f: BodyFeatures;
  c: Classification;
}

export function analyse(params: Partial<SyntheticPoseParams>, baseline: Baseline): Analysed {
  const pose = makePose({ lowerBodyVisible: baseline.mode === 'full', ...params });
  const f = extractFeatures(pose, baseline);
  return { pose, f, c: classify(f, baseline.mode) };
}

/**
 * Named synthetic landmark fixtures: correct, almost-correct and wrong executions.
 * Seated-scheme fixtures are analysed with an upper-body baseline (calibrate(false)),
 * body-scheme fixtures with a full-body baseline (calibrate(true)).
 */
export const BODY_FIXTURES = {
  neutral: {},
  validStepLeft: { shift: -0.7 },
  validStepRight: { shift: 0.7 },
  almostStepLeft: { shift: -0.25 },
  shouldersOnlyLeft: { leanDeg: -22 },
  validRealJump: { rise: 0.35 },
  lowJump: { rise: 0.12 },
  armsOnlyJump: { leftArm: 1, rightArm: 1 },
  validSquat: { crouch: 0.5 },
  almostSquat: { crouch: 0.2 },
  bowInsteadOfSquat: { bow: 0.4 },
  jumpWhileStepping: { shift: -0.7, rise: 0.35 },
} satisfies Record<string, Partial<SyntheticPoseParams>>;

export const FIXTURES = {
  neutral: {},
  validLeftLean: { leanDeg: -22 },
  invalidLeftLean: { leanDeg: -9 },
  holdLeftLean: { leanDeg: -13.3 },
  validRightLean: { leanDeg: 22 },
  wrongDirectionForLeft: { leanDeg: 15 },
  headOnlyLeft: { headShift: -0.4 },
  turnedSideways: { turn: 0.6 },
  validJump: { leftArm: 1, rightArm: 1 },
  almostJump: { leftArm: 0.55, rightArm: 0.55 },
  oneHandJump: { leftArm: 1, rightArm: 0 },
  oneHandLowJump: { leftArm: 1, rightArm: 0.5 },
  bentArmsJump: { leftArm: 0.45, rightArm: 0.45, leftElbowBend: 60, rightElbowBend: 60 },
  handsOutOfFrame: { leftArm: 0.6, rightArm: 0.6, leftWristVisibility: 0.1, rightWristVisibility: 0.1 },
  elbowsUpWristsHidden: { leftArm: 0.72, rightArm: 0.72, leftWristVisibility: 0.1, rightWristVisibility: 0.1 },
  validCrouch: { crouch: 0.55 },
  almostCrouch: { crouch: 0.22 },
  headOnlyCrouch: { headDrop: 0.4 },
  bowInsteadOfSquat: { bow: 0.3 },
  crouchLeaning: { crouch: 0.15, leanDeg: -20 },
  crouchWithArmsUp: { crouch: 0.55, leftArm: 1, rightArm: 1 },
} satisfies Record<string, Partial<SyntheticPoseParams>>;
