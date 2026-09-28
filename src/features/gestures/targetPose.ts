import { GESTURE_CONFIG } from '../../config/gesture.config';
import { clamp, distance, midpoint, rotateAround, tiltFromVertical, type Point } from '../../lib/math/geometry';
import { copyPoseInto, createPose, LM, lm, UPPER_BODY_MAX_INDEX, type Pose } from '../tracking/landmarks';
import type { Baseline } from './calibration';
import { thresholdsFor } from './thresholds';
import type { ExpectedMotion } from './types';

/** How far past the threshold the ghost shows the target (so matching it is a clear success). */
const OVERSHOOT = 1.15;
const ARM_SPREAD_DEG = 12;

function translate(pose: Pose, maxIndex: number, dx: number, dy: number): void {
  for (let i = 0; i <= maxIndex; i++) {
    const p = pose[i];
    if (!p) continue;
    p.x += dx;
    p.y += dy;
  }
}

function raiseArm(pose: Pose, side: -1 | 1, baseline: Baseline): void {
  const [s, e, w, idx, pinky, thumb] =
    side < 0
      ? [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.LEFT_INDEX, LM.LEFT_PINKY, LM.LEFT_THUMB]
      : [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST, LM.RIGHT_INDEX, LM.RIGHT_PINKY, LM.RIGHT_THUMB];
  const shoulder = lm(pose, s);
  const elbow = lm(pose, e);
  const upper = elbow.v > 0.5 ? clamp(distance(shoulder, elbow), baseline.armLength * 0.4, baseline.armLength * 0.6) : baseline.armLength * 0.52;
  const fore = baseline.armLength - upper;
  const rad = (ARM_SPREAD_DEG * Math.PI) / 180;
  const dir: Point = { x: side * Math.sin(rad), y: -Math.cos(rad) };
  const place = (index: number, from: Point, length: number) => {
    const p = lm(pose, index);
    p.x = from.x + dir.x * length;
    p.y = from.y + dir.y * length;
    p.v = 1;
    return p;
  };
  const newElbow = place(e, shoulder, upper);
  const newWrist = place(w, newElbow, fore);
  const hand = baseline.scale * 0.16;
  place(idx, newWrist, hand);
  place(pinky, { x: newWrist.x + side * hand * 0.3, y: newWrist.y }, hand * 0.8);
  place(thumb, { x: newWrist.x - side * hand * 0.4, y: newWrist.y }, hand * 0.6);
}

/**
 * Builds the "ghost" skeleton: the player's CURRENT pose, minimally modified
 * so that it satisfies the expected motion. Rendering current vs ghost shows
 * exactly which body part must move, where, and how far.
 */
export function buildTargetPose(pose: Pose, expected: ExpectedMotion, baseline: Baseline, out: Pose = createPose()): Pose {
  copyPoseInto(pose, out);
  const shoulderCenter = midpoint(lm(out, LM.LEFT_SHOULDER), lm(out, LM.RIGHT_SHOULDER));

  switch (expected) {
    case 'JUMP':
      raiseArm(out, -1, baseline);
      raiseArm(out, 1, baseline);
      break;

    case 'LEAN_LEFT':
    case 'LEAN_RIGHT': {
      const dir = expected === 'LEAN_LEFT' ? -1 : 1;
      const targetX = baseline.shoulderCenter.x + dir * thresholdsFor(expected, baseline.mode).activation * OVERSHOOT * baseline.scale;
      if (dir * (shoulderCenter.x - targetX) >= 0) break;
      const lh = lm(out, LM.LEFT_HIP);
      const rh = lm(out, LM.RIGHT_HIP);
      if (Math.min(lh.v, rh.v) > 0.5) {
        const hip = midpoint(lh, rh);
        const torso = distance(hip, shoulderCenter);
        const current = tiltFromVertical(hip, shoulderCenter);
        const target = (Math.asin(clamp((targetX - hip.x) / torso, -0.9, 0.9)) * 180) / Math.PI;
        for (let i = 0; i <= UPPER_BODY_MAX_INDEX; i++) {
          const p = out[i];
          if (!p) continue;
          const r = rotateAround(p, hip, target - current);
          p.x = r.x;
          p.y = r.y;
        }
      } else {
        translate(out, UPPER_BODY_MAX_INDEX, targetX - shoulderCenter.x, 0);
      }
      break;
    }

    case 'CROUCH': {
      const targetY = baseline.shoulderCenter.y + thresholdsFor('CROUCH', baseline.mode).activation * OVERSHOOT * baseline.scale;
      const dy = targetY - shoulderCenter.y;
      if (dy <= 0) break;
      translate(out, LM.RIGHT_HIP, 0, dy);
      const lk = lm(out, LM.LEFT_KNEE);
      const rk = lm(out, LM.RIGHT_KNEE);
      lk.y += dy * 0.5;
      rk.y += dy * 0.5;
      lk.x -= dy * 0.3;
      rk.x += dy * 0.3;
      break;
    }

    case 'CENTER':
      translate(out, UPPER_BODY_MAX_INDEX, baseline.shoulderCenter.x - shoulderCenter.x, 0);
      break;
  }
  return out;
}

export interface TargetGuide {
  orientation: 'horizontal' | 'vertical';
  /** Line position in frame units (y for horizontal, x for vertical). */
  value: number;
  label: string;
}

/** Threshold lines drawn on the camera view: "get your hands above this line". */
export function targetGuides(expected: ExpectedMotion, baseline: Baseline, currentShoulderY: number): TargetGuide[] {
  switch (expected) {
    case 'JUMP':
      return [
        {
          orientation: 'horizontal',
          value: currentShoulderY - thresholdsFor('JUMP', baseline.mode).activation * baseline.armLength,
          label: 'РУКИ ВЫШЕ',
        },
      ];
    case 'LEAN_LEFT':
    case 'LEAN_RIGHT': {
      const dir = expected === 'LEAN_LEFT' ? -1 : 1;
      return [
        {
          orientation: 'vertical',
          value: baseline.shoulderCenter.x + dir * thresholdsFor(expected, baseline.mode).activation * baseline.scale,
          label: dir < 0 ? '◀ ПЛЕЧИ СЮДА' : 'ПЛЕЧИ СЮДА ▶',
        },
      ];
    }
    case 'CROUCH':
      return [
        {
          orientation: 'horizontal',
          value: baseline.shoulderCenter.y + thresholdsFor('CROUCH', baseline.mode).activation * baseline.scale,
          label: 'ПЛЕЧИ НИЖЕ',
        },
      ];
    case 'CENTER': {
      const tol = GESTURE_CONFIG.center.tolerance * baseline.scale;
      return [
        { orientation: 'vertical', value: baseline.shoulderCenter.x - tol, label: '' },
        { orientation: 'vertical', value: baseline.shoulderCenter.x + tol, label: 'ЦЕНТР' },
      ];
    }
  }
}
