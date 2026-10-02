import { GESTURE_CONFIG } from '../../config/gesture.config';
import { TRACKING_CONFIG } from '../../config/tracking.config';
import { angle, distance, lineTilt, midpoint, normalizeByBodyScale, tiltFromVertical, type Point } from '../../lib/math/geometry';
import { LM, lm, type Pose } from '../tracking/landmarks';
import { zoneOf, type Baseline } from './calibration';

/** Absolute body geometry of one frame (mirrored frame units). */
export interface BodyGeometry {
  shoulderCenter: Point;
  hipCenter: Point | null;
  nose: Point;
  shoulderWidth: number;
  torsoLength: number | null;
  shoulderTiltDeg: number;
  torsoTiltDeg: number | null;
  leftShoulder: Point;
  rightShoulder: Point;
  leftElbow: Point;
  rightElbow: Point;
  leftWrist: Point;
  rightWrist: Point;
  leftElbowAngle: number;
  rightElbowAngle: number;
  leftWristVisible: boolean;
  rightWristVisible: boolean;
  leftElbowVisible: boolean;
  rightElbowVisible: boolean;
  hipsVisible: boolean;
  /** Segment lengths for arm-length calibration (only meaningful when visible). */
  leftArmLength: number;
  rightArmLength: number;
  /** Landmark confidence per body region, 0..1 — feeds gesture confidence. */
  visibility: {
    shoulders: number;
    leftArm: number;
    rightArm: number;
    hips: number;
  };
}

/**
 * Body-relative motion features: everything is a displacement from the
 * calibrated neutral pose, divided by the player's own body size.
 */
export interface BodyFeatures extends BodyGeometry {
  /** Shoulder-centre lateral shift in SW. Negative = player's left. */
  leanX: number;
  /** Nose lateral shift in SW. */
  headX: number;
  /** Shoulder-centre drop in SW. Positive = lower than standing. */
  crouchDepth: number;
  /** Nose drop in SW. */
  noseDrop: number;
  /** Hip-centre drop in SW (null when hips are not visible). */
  hipDrop: number | null;
  /** Hip-centre lateral shift in SW (null when hips are not visible) — whole-body movement. */
  hipShiftX: number | null;
  /**
   * Position in the play area (-1 left edge … +1 right edge), from the hips
   * (shoulders if hips are hidden or the baseline picks lanes by the shoulders).
   * null when no play area is known.
   */
  zoneX: number | null;
  /**
   * How far the whole body rose, in SW: min(hip rise, shoulder rise), so a shrug
   * or raised arms (shoulders only) never looks like a jump.
   */
  bodyRise: number;
  /** Wrist height above its own shoulder, in ARM. Positive = above. */
  leftHandLift: number;
  rightHandLift: number;
  /** Effective lift used for recognition (falls back to elbow when the wrist is out of frame). */
  leftHandLiftEffective: number;
  rightHandLiftEffective: number;
  leftElbowLift: number;
  rightElbowLift: number;
  /** Current shoulder width / calibrated shoulder width. */
  scaleRatio: number;
}

export function extractGeometry(pose: Pose): BodyGeometry {
  const q = TRACKING_CONFIG.quality;
  const ls = lm(pose, LM.LEFT_SHOULDER);
  const rs = lm(pose, LM.RIGHT_SHOULDER);
  const le = lm(pose, LM.LEFT_ELBOW);
  const re = lm(pose, LM.RIGHT_ELBOW);
  const lw = lm(pose, LM.LEFT_WRIST);
  const rw = lm(pose, LM.RIGHT_WRIST);
  const lh = lm(pose, LM.LEFT_HIP);
  const rh = lm(pose, LM.RIGHT_HIP);
  const nose = lm(pose, LM.NOSE);

  const shoulderCenter = midpoint(ls, rs);
  const hipsVisible = Math.min(lh.v, rh.v) >= q.minHipVisibility;
  const hipCenter = hipsVisible ? midpoint(lh, rh) : null;

  return {
    shoulderCenter,
    hipCenter,
    nose: { x: nose.x, y: nose.y },
    shoulderWidth: distance(ls, rs),
    torsoLength: hipCenter ? distance(shoulderCenter, hipCenter) : null,
    shoulderTiltDeg: lineTilt(ls, rs),
    torsoTiltDeg: hipCenter ? tiltFromVertical(hipCenter, shoulderCenter) : null,
    leftShoulder: { x: ls.x, y: ls.y },
    rightShoulder: { x: rs.x, y: rs.y },
    leftElbow: { x: le.x, y: le.y },
    rightElbow: { x: re.x, y: re.y },
    leftWrist: { x: lw.x, y: lw.y },
    rightWrist: { x: rw.x, y: rw.y },
    leftElbowAngle: angle(ls, le, lw),
    rightElbowAngle: angle(rs, re, rw),
    leftWristVisible: lw.v >= q.minWristVisibility,
    rightWristVisible: rw.v >= q.minWristVisibility,
    leftElbowVisible: le.v >= q.minWristVisibility,
    rightElbowVisible: re.v >= q.minWristVisibility,
    hipsVisible,
    leftArmLength: distance(ls, le) + distance(le, lw),
    rightArmLength: distance(rs, re) + distance(re, rw),
    visibility: {
      shoulders: Math.min(ls.v, rs.v),
      leftArm: Math.max(lw.v, le.v * 0.9),
      rightArm: Math.max(rw.v, re.v * 0.9),
      hips: Math.min(lh.v, rh.v),
    },
  };
}

function effectiveLift(wristLift: number, elbowLift: number, wristVisible: boolean, elbowVisible: boolean): number {
  if (wristVisible) return wristLift;
  const j = GESTURE_CONFIG.jump;
  // Wrist left the frame (common when raising hands close to the camera):
  // a high elbow is strong evidence of a raised arm.
  if (elbowVisible && elbowLift >= j.elbowFallbackLift) return elbowLift * j.elbowToWristFactor;
  return j.rest;
}

/**
 * FeatureExtractor: pose → body-relative features.
 * Without a baseline (before calibration) relative features are computed
 * against the frame itself, which is only used for display.
 */
export function extractFeatures(pose: Pose, baseline: Baseline | null): BodyFeatures {
  const g = extractGeometry(pose);
  const scale = baseline?.scale ?? g.shoulderWidth;
  const arm = baseline?.armLength ?? g.shoulderWidth * GESTURE_CONFIG.calibration.fallbackArmSW;
  const ref = baseline?.shoulderCenter ?? g.shoulderCenter;
  const refNose = baseline?.nose ?? g.nose;

  const leftHandLift = normalizeByBodyScale(g.leftShoulder.y - g.leftWrist.y, arm);
  const rightHandLift = normalizeByBodyScale(g.rightShoulder.y - g.rightWrist.y, arm);
  const leftElbowLift = normalizeByBodyScale(g.leftShoulder.y - g.leftElbow.y, arm);
  const rightElbowLift = normalizeByBodyScale(g.rightShoulder.y - g.rightElbow.y, arm);
  const crouchDepth = normalizeByBodyScale(g.shoulderCenter.y - ref.y, scale);
  const baseHip = baseline?.hipCenter ?? null;
  const hipDrop = g.hipCenter && baseHip ? normalizeByBodyScale(g.hipCenter.y - baseHip.y, scale) : null;
  const laneX = baseline?.laneFrom === 'shoulders' ? g.shoulderCenter.x : (g.hipCenter ?? g.shoulderCenter).x;

  return {
    ...g,
    leanX: normalizeByBodyScale(g.shoulderCenter.x - ref.x, scale),
    headX: normalizeByBodyScale(g.nose.x - refNose.x, scale),
    crouchDepth,
    noseDrop: normalizeByBodyScale(g.nose.y - refNose.y, scale),
    hipDrop,
    hipShiftX: g.hipCenter && baseHip ? normalizeByBodyScale(g.hipCenter.x - baseHip.x, scale) : null,
    zoneX: baseline?.region ? zoneOf(laneX, baseline.region) : null,
    bodyRise: hipDrop === null ? -crouchDepth : Math.min(-hipDrop, -crouchDepth),
    leftHandLift,
    rightHandLift,
    leftHandLiftEffective: effectiveLift(leftHandLift, leftElbowLift, g.leftWristVisible, g.leftElbowVisible),
    rightHandLiftEffective: effectiveLift(rightHandLift, rightElbowLift, g.rightWristVisible, g.rightElbowVisible),
    leftElbowLift,
    rightElbowLift,
    scaleRatio: normalizeByBodyScale(g.shoulderWidth, scale),
  };
}
