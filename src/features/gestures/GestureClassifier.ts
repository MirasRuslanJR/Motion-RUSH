import { clamp } from '../../lib/math/geometry';
import type { BodyMode } from './calibration';
import type { BodyFeatures } from './FeatureExtractor';
import { gestureMetric, isFastGesture, progressOf, thresholdsFor, type GestureThresholds } from './thresholds';
import { GESTURE_CHANNEL, GESTURE_PRIORITY, GESTURE_TYPES, schemeOf, type GestureChannel, type GestureType } from './types';

export interface GestureReading {
  type: GestureType;
  metric: number;
  thresholds: GestureThresholds;
  /** 0 = rest, 1 = activation threshold reached. */
  progress: number;
  /** metric ≥ near: the user is visibly trying. */
  attempting: boolean;
  /** metric ≥ activation: gesture can start. */
  active: boolean;
  /** metric ≥ release: a started gesture keeps going (hysteresis). */
  held: boolean;
  /** Landmark visibility × margin over the threshold, 0..1. */
  confidence: number;
  /** Confirm on the first clear frame (short-lived gestures like a real jump). */
  fast: boolean;
}

export interface Classification {
  readings: Record<GestureType, GestureReading>;
  /** Winning active candidate per channel (null = neutral). */
  candidates: Record<GestureChannel, GestureType | null>;
}

function visibilityFor(type: GestureType, f: BodyFeatures, mode: BodyMode | null): number {
  if (schemeOf(mode) === 'body') {
    // Whole-body gestures are read from the hips (fall back to shoulders if hips flicker out).
    return f.hipCenter ? Math.min(f.visibility.hips, f.visibility.shoulders) : f.visibility.shoulders;
  }
  switch (type) {
    case 'LEAN_LEFT':
    case 'LEAN_RIGHT':
      return f.visibility.shoulders;
    case 'JUMP':
      return Math.min(f.visibility.leftArm, f.visibility.rightArm);
    case 'CROUCH':
      return f.visibility.shoulders;
  }
}

function read(type: GestureType, f: BodyFeatures, mode: BodyMode | null): GestureReading {
  const thresholds = thresholdsFor(type, mode);
  const metric = gestureMetric(type, f, mode);
  const margin = clamp(0.55 + (0.45 * (metric - thresholds.release)) / (thresholds.activation - thresholds.release), 0, 1);
  return {
    type,
    metric,
    thresholds,
    progress: progressOf(metric, thresholds),
    attempting: metric >= thresholds.near,
    active: metric >= thresholds.activation,
    held: metric >= thresholds.release,
    confidence: clamp(visibilityFor(type, f, mode), 0, 1) * margin,
    fast: isFastGesture(type, mode),
  };
}

/**
 * GestureClassifier: rule-based, explainable. Each gesture is one body-relative
 * metric compared against calibrated thresholds. Returns per-gesture readings
 * (used by the error engine and UI meters) plus one candidate per channel.
 */
export function classify(f: BodyFeatures, mode: BodyMode | null): Classification {
  const readings = {} as Record<GestureType, GestureReading>;
  for (const type of GESTURE_TYPES) readings[type] = read(type, f, mode);

  const candidates: Record<GestureChannel, GestureType | null> = { lateral: null, vertical: null };
  for (const type of GESTURE_TYPES) {
    const r = readings[type];
    if (!r.active) continue;
    const channel = GESTURE_CHANNEL[type];
    const current = candidates[channel];
    if (!current) {
      candidates[channel] = type;
      continue;
    }
    const cur = readings[current];
    const better =
      GESTURE_PRIORITY[type] > GESTURE_PRIORITY[current] ||
      (GESTURE_PRIORITY[type] === GESTURE_PRIORITY[current] && r.progress > cur.progress);
    if (better) candidates[channel] = type;
  }
  return { readings, candidates };
}
