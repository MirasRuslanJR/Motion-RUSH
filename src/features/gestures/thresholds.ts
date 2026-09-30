import { GESTURE_CONFIG } from '../../config/gesture.config';
import { clamp } from '../../lib/math/geometry';
import type { BodyMode } from './calibration';
import type { BodyFeatures } from './FeatureExtractor';
import { schemeOf, type ControlScheme, type GestureType } from './types';

export interface GestureThresholds {
  rest: number;
  near: number;
  activation: number;
  release: number;
}

const pick = (c: GestureThresholds): GestureThresholds => ({
  rest: c.rest,
  near: c.near,
  activation: c.activation,
  release: c.release,
});

/** Thresholds for a gesture in the control scheme chosen by calibration. */
export function thresholdsFor(type: GestureType, mode: BodyMode | null): GestureThresholds {
  const body = schemeOf(mode) === 'body';
  switch (type) {
    case 'LEAN_LEFT':
    case 'LEAN_RIGHT':
      return pick(body ? GESTURE_CONFIG.body.step : GESTURE_CONFIG.lean);
    case 'JUMP':
      return pick(body ? GESTURE_CONFIG.body.jump : GESTURE_CONFIG.jump);
    case 'CROUCH':
      return pick(body ? GESTURE_CONFIG.body.squat : GESTURE_CONFIG.crouch);
  }
}

/** Sideways offset used for lanes: hips (whole body) in the body scheme, shoulders when seated. */
export function lateralOffset(f: BodyFeatures, scheme: ControlScheme): number {
  return scheme === 'body' ? (f.hipShiftX ?? f.leanX) : f.leanX;
}

/**
 * The single scalar each gesture is judged on. Larger = more of the gesture.
 *   body:   hip shift (step), whole-body rise (jump), hip drop (squat)
 *   seated: shoulder shift (lean), LOWER hand height (arms up), shoulder drop (duck)
 */
export function gestureMetric(type: GestureType, f: BodyFeatures, mode: BodyMode | null): number {
  const scheme = schemeOf(mode);
  switch (type) {
    case 'LEAN_LEFT':
      return -lateralOffset(f, scheme);
    case 'LEAN_RIGHT':
      return lateralOffset(f, scheme);
    case 'JUMP':
      return scheme === 'body' ? f.bodyRise : Math.min(f.leftHandLiftEffective, f.rightHandLiftEffective);
    case 'CROUCH':
      return scheme === 'body' ? (f.hipDrop ?? f.crouchDepth) : f.crouchDepth;
  }
}

/** Gestures confirmed on the first clear frame (a real jump is airborne only ~350 ms). */
export function isFastGesture(type: GestureType, mode: BodyMode | null): boolean {
  return type === 'JUMP' && schemeOf(mode) === 'body';
}

/** 0 at rest, 1 at the activation threshold (may overshoot slightly). */
export function progressOf(metric: number, th: GestureThresholds): number {
  const span = th.activation - th.rest;
  return span === 0 ? 0 : clamp((metric - th.rest) / span, 0, 1.25);
}
