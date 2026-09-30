import type { Point } from '../../lib/math/geometry';
import { createPose, LM, type Pose } from './landmarks';

/**
 * Parametric human figure in mirrored frame units.
 * Used for (1) unit-test fixtures of correct / incorrect gestures and
 * (2) the animated demo figures on the landing and tutorial screens.
 * Not used for recognition — the live pipeline only consumes camera landmarks.
 */
export interface SyntheticPoseParams {
  /** Neutral shoulder-centre position (frame units). */
  cx: number;
  cy: number;
  /** Shoulder width (frame units). */
  sw: number;
  /** Whole-body sideways step, in shoulder widths. */
  shift?: number;
  /** Torso lean from the hips, degrees. Positive = toward screen right. */
  leanDeg?: number;
  /** Vertical drop of hips + upper body, in shoulder widths. */
  crouch?: number;
  /** Arm raise: 0 = hanging down, 1 = straight up. */
  leftArm?: number;
  rightArm?: number;
  /** Elbow bend in degrees (0 = straight arm). */
  leftElbowBend?: number;
  rightElbowBend?: number;
  /** Head moves sideways (shoulder widths) without the shoulders. */
  headShift?: number;
  /** Head drops (nod), shoulder widths. */
  headDrop?: number;
  /** Upper body drops while hips stay (bowing instead of squatting), shoulder widths. */
  bow?: number;
  /** Whole body is lifted off the ground (a real jump), shoulder widths. */
  rise?: number;
  /** Apparent shoulder width factor: < 1 means the body is turned sideways. */
  turn?: number;
  /** false = seated / upper-body framing: hips and legs are not visible. */
  lowerBodyVisible?: boolean;
  leftWristVisibility?: number;
  rightWristVisibility?: number;
  visibility?: number;
}

/** Body proportions in shoulder widths. */
const BODY = {
  torso: 1.3,
  hipHalfWidth: 0.36,
  neckToNose: 0.55,
  upperArm: 0.82,
  forearm: 0.75,
  hand: 0.18,
  thigh: 1.25,
  shin: 1.25,
} as const;

function add(a: Point, b: Point, k = 1): Point {
  return { x: a.x + b.x * k, y: a.y + b.y * k };
}

function rotate(v: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function buildSyntheticPose(params: SyntheticPoseParams, out: Pose = createPose()): Pose {
  const {
    cx,
    cy,
    sw,
    shift = 0,
    leanDeg = 0,
    crouch = 0,
    leftArm = 0,
    rightArm = 0,
    leftElbowBend = 0,
    rightElbowBend = 0,
    headShift = 0,
    headDrop = 0,
    bow = 0,
    rise = 0,
    turn = 1,
    lowerBodyVisible = true,
    leftWristVisibility,
    rightWristVisibility,
    visibility = 0.98,
  } = params;

  const set = (index: number, p: Point, v = visibility) => {
    const target = out[index];
    if (!target) return;
    target.x = p.x;
    target.y = p.y;
    target.z = 0;
    target.v = v;
  };

  const hipRest: Point = { x: cx + shift * sw, y: cy + BODY.torso * sw };
  const hipCenter: Point = { x: hipRest.x, y: hipRest.y + crouch * sw };
  const theta = (leanDeg * Math.PI) / 180;
  const up: Point = { x: Math.sin(theta), y: -Math.cos(theta) };
  const right: Point = { x: Math.cos(theta), y: Math.sin(theta) };
  const halfShoulder = (sw * turn) / 2;

  const shoulderCenter = add(add(hipCenter, up, BODY.torso * sw), { x: 0, y: bow * sw });
  const leftShoulder = add(shoulderCenter, right, -halfShoulder);
  const rightShoulder = add(shoulderCenter, right, halfShoulder);
  set(LM.LEFT_SHOULDER, leftShoulder);
  set(LM.RIGHT_SHOULDER, rightShoulder);

  // Head
  const nose = add(add(shoulderCenter, up, BODY.neckToNose * sw), { x: headShift * sw, y: headDrop * sw });
  set(LM.NOSE, nose);
  const eye = (dx: number, dy: number) => add(add(nose, right, dx * sw), up, dy * sw);
  set(LM.LEFT_EYE_INNER, eye(-0.06, 0.08));
  set(LM.LEFT_EYE, eye(-0.1, 0.09));
  set(LM.LEFT_EYE_OUTER, eye(-0.14, 0.09));
  set(LM.RIGHT_EYE_INNER, eye(0.06, 0.08));
  set(LM.RIGHT_EYE, eye(0.1, 0.09));
  set(LM.RIGHT_EYE_OUTER, eye(0.14, 0.09));
  set(LM.LEFT_EAR, eye(-0.22, 0.04));
  set(LM.RIGHT_EAR, eye(0.22, 0.04));
  set(LM.MOUTH_LEFT, eye(-0.06, -0.1));
  set(LM.MOUTH_RIGHT, eye(0.06, -0.1));

  // Arms: raise angle measured from "hanging down", swinging outward.
  const arm = (side: -1 | 1, raise: number, bend: number, wristVis: number | undefined) => {
    const shoulder = side < 0 ? leftShoulder : rightShoulder;
    const alpha = ((8 + raise * 164) * Math.PI) / 180;
    const down: Point = { x: -up.x, y: -up.y };
    const dir: Point = {
      x: right.x * side * Math.sin(alpha) + down.x * Math.cos(alpha),
      y: right.y * side * Math.sin(alpha) + down.y * Math.cos(alpha),
    };
    const elbow = add(shoulder, dir, BODY.upperArm * sw);
    const foreDir = rotate(dir, -side * bend);
    const wrist = add(elbow, foreDir, BODY.forearm * sw);
    const index = add(wrist, foreDir, BODY.hand * sw);
    const side90 = rotate(foreDir, 90);
    const wv = wristVis ?? visibility;
    const ids =
      side < 0
        ? [LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.LEFT_INDEX, LM.LEFT_PINKY, LM.LEFT_THUMB]
        : [LM.RIGHT_ELBOW, LM.RIGHT_WRIST, LM.RIGHT_INDEX, LM.RIGHT_PINKY, LM.RIGHT_THUMB];
    set(ids[0] ?? 0, elbow);
    set(ids[1] ?? 0, wrist, wv);
    set(ids[2] ?? 0, index, wv);
    set(ids[3] ?? 0, add(index, side90, 0.05 * sw * side), wv);
    set(ids[4] ?? 0, add(wrist, side90, -0.07 * sw * side), wv);
  };
  arm(-1, leftArm, leftElbowBend, leftWristVisibility);
  arm(1, rightArm, rightElbowBend, rightWristVisibility);

  // Hips + legs (feet stay planted on the ground while crouching).
  const lowerVis = lowerBodyVisible ? visibility : 0.05;
  const hipHalf = BODY.hipHalfWidth * sw * turn;
  const groundY = hipRest.y + (BODY.thigh + BODY.shin) * sw;
  const legLength = (BODY.thigh + BODY.shin) * sw;
  const leg = (side: -1 | 1) => {
    const hip: Point = { x: hipCenter.x + side * hipHalf, y: hipCenter.y };
    const ankle: Point = { x: hipRest.x + side * (hipHalf + 0.06 * sw), y: groundY };
    const vertical = Math.max(ankle.y - hip.y, 0.2 * legLength);
    const halfSpan = Math.sqrt(Math.max((BODY.thigh * sw) ** 2 - (vertical / 2) ** 2, 0));
    const knee: Point = { x: (hip.x + ankle.x) / 2 + side * halfSpan * 0.45, y: hip.y + vertical / 2 };
    const ids =
      side < 0
        ? [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX]
        : [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX];
    set(ids[0] ?? 0, hip, lowerVis);
    set(ids[1] ?? 0, knee, lowerVis);
    set(ids[2] ?? 0, ankle, lowerVis);
    set(ids[3] ?? 0, { x: ankle.x - side * 0.02 * sw, y: ankle.y + 0.08 * sw }, lowerVis);
    set(ids[4] ?? 0, { x: ankle.x + side * 0.18 * sw, y: ankle.y + 0.1 * sw }, lowerVis);
  };
  leg(-1);
  leg(1);

  if (rise !== 0) {
    for (const p of out) p.y -= rise * sw;
  }
  return out;
}
