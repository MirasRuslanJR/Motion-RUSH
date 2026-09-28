import { GESTURE_CONFIG } from '../../config/gesture.config';
import { clamp } from '../../lib/math/geometry';
import type { BodyMode } from './calibration';
import type { BodyFeatures } from './FeatureExtractor';
import type { GestureType } from './types';

export interface GestureThresholds {
  rest: number;
  near: number;
  activation: number;
  release: number;
}

/** Thresholds for a gesture, adapted to the calibrated framing mode. */
export function thresholdsFor(type: GestureType, mode: BodyMode | null): GestureThresholds {
  switch (type) {
    case 'LEAN_LEFT':
    case 'LEAN_RIGHT': {
      const c = GESTURE_CONFIG.lean;
      return { rest: c.rest, near: c.near, activation: c.activation, release: c.release };
    }
    case 'JUMP': {
      const c = GESTURE_CONFIG.jump;
      return { rest: c.rest, near: c.near, activation: c.activation, release: c.release };
    }
    case 'CROUCH': {
      const c = GESTURE_CONFIG.crouch;
      const upper = mode === 'upper';
      return {
        rest: c.rest,
        near: c.near,
        activation: upper ? c.activationUpperBody : c.activation,
        release: upper ? c.releaseUpperBody : c.release,
      };
    }
  }
}

/**
 * The single scalar each gesture is judged on. Larger = more of the gesture.
 * JUMP uses the LOWER hand so both arms must be up.
 */
export function gestureMetric(type: GestureType, f: BodyFeatures): number {
  switch (type) {
    case 'LEAN_LEFT':
      return -f.leanX;
    case 'LEAN_RIGHT':
      return f.leanX;
    case 'JUMP':
      return Math.min(f.leftHandLiftEffective, f.rightHandLiftEffective);
    case 'CROUCH':
      return f.crouchDepth;
  }
}

/** 0 at rest, 1 at the activation threshold (may overshoot slightly). */
export function progressOf(metric: number, th: GestureThresholds): number {
  const span = th.activation - th.rest;
  return span === 0 ? 0 : clamp((metric - th.rest) / span, 0, 1.25);
}
