import { GESTURE_CONFIG } from '../../config/gesture.config';
import { clamp, distance, median, type Point } from '../../lib/math/geometry';
import type { BodyGeometry } from './FeatureExtractor';

export type BodyMode = 'full' | 'upper';

/**
 * Personal neutral pose captured during calibration.
 * Every gesture threshold is applied RELATIVE to these values.
 */
export interface Baseline {
  shoulderCenter: Point;
  hipCenter: Point | null;
  nose: Point;
  /** Shoulder width — the body unit (SW). */
  scale: number;
  /** Shoulder→elbow→wrist length — the arm unit (ARM). */
  armLength: number;
  torsoLength: number | null;
  /** full = hips visible (standing back), upper = seated / close framing. */
  mode: BodyMode;
  /**
   * Horizontal play area in frame units (the whole frame, or one half in
   * two-player mode). Lanes in the body scheme are thirds of it.
   */
  region?: { x0: number; x1: number };
}

/** Where the body stands inside the play area: -1 left edge … 0 middle … +1 right edge. */
export function zoneOf(x: number, region: { x0: number; x1: number }): number {
  const half = (region.x1 - region.x0) / 2;
  return half > 0 ? (x - (region.x0 + half)) / half : 0;
}

/** Inverse of zoneOf. */
export function xOfZone(zone: number, region: { x0: number; x1: number }): number {
  const half = (region.x1 - region.x0) / 2;
  return region.x0 + half + zone * half;
}

export type CalibrationIssue = 'NOT_TRACKED' | 'ARMS_UP' | 'MOVING';

export const CALIBRATION_MESSAGES: Record<CalibrationIssue, string> = {
  NOT_TRACKED: 'Встань так, чтобы были видны голова и плечи',
  ARMS_UP: 'Опусти руки вдоль тела',
  MOVING: 'Замри на пару секунд — стой ровно',
};

export interface CalibrationProgress {
  /** 0..1 */
  progress: number;
  issue: CalibrationIssue | null;
  done: boolean;
}

/** Same keys as GESTURE_CONFIG.calibration, any values (two-player mode uses a quicker capture). */
type CalibrationConfig = { readonly [K in keyof typeof GESTURE_CONFIG.calibration]: number };

export function computeBaseline(samples: readonly BodyGeometry[], cfg: CalibrationConfig = GESTURE_CONFIG.calibration): Baseline {
  const scale = median(samples.map((s) => s.shoulderWidth));
  const withHips = samples.filter((s) => s.hipCenter !== null);
  const fullBody = withHips.length >= samples.length * 0.6;

  const armSamples: number[] = [];
  for (const s of samples) {
    if (s.leftWristVisible && s.leftElbowVisible) armSamples.push(s.leftArmLength);
    if (s.rightWristVisible && s.rightElbowVisible) armSamples.push(s.rightArmLength);
  }
  const measuredArm = armSamples.length >= samples.length * 0.5 ? median(armSamples) : scale * cfg.fallbackArmSW;

  return {
    shoulderCenter: {
      x: median(samples.map((s) => s.shoulderCenter.x)),
      y: median(samples.map((s) => s.shoulderCenter.y)),
    },
    hipCenter: fullBody
      ? {
          x: median(withHips.map((s) => s.hipCenter?.x ?? 0)),
          y: median(withHips.map((s) => s.hipCenter?.y ?? 0)),
        }
      : null,
    nose: { x: median(samples.map((s) => s.nose.x)), y: median(samples.map((s) => s.nose.y)) },
    scale,
    armLength: clamp(measuredArm, scale * cfg.minArmSW, scale * cfg.maxArmSW),
    torsoLength: fullBody ? median(withHips.map((s) => s.torsoLength ?? 0)) : null,
    mode: fullBody ? 'full' : 'upper',
  };
}

/**
 * Collects a still, arms-down neutral pose for `durationMs`.
 * Any movement or raised hand restarts the capture — a bad baseline would
 * silently break every threshold afterwards, so we are strict here.
 */
export class Calibrator {
  private readonly cfg: CalibrationConfig;
  private samples: BodyGeometry[] = [];
  private startedAt: number | null = null;
  private anchor: Point | null = null;
  private baselineResult: Baseline | null = null;

  constructor(cfg: CalibrationConfig = GESTURE_CONFIG.calibration) {
    this.cfg = cfg;
  }

  get baseline(): Baseline | null {
    return this.baselineResult;
  }

  reset(): void {
    this.samples = [];
    this.startedAt = null;
    this.anchor = null;
    this.baselineResult = null;
  }

  private restart(issue: CalibrationIssue, anchor: Point | null): CalibrationProgress {
    this.samples = [];
    this.startedAt = null;
    this.anchor = anchor;
    return { progress: 0, issue, done: false };
  }

  push(geometry: BodyGeometry | null, trackable: boolean, timeMs: number): CalibrationProgress {
    if (this.baselineResult) return { progress: 1, issue: null, done: true };
    if (!geometry || !trackable) return this.restart('NOT_TRACKED', null);

    const armsUp =
      (geometry.leftWristVisible && geometry.leftWrist.y < geometry.leftShoulder.y) ||
      (geometry.rightWristVisible && geometry.rightWrist.y < geometry.rightShoulder.y);
    if (armsUp) return this.restart('ARMS_UP', null);

    if (this.anchor && distance(geometry.shoulderCenter, this.anchor) > this.cfg.maxDriftSW * geometry.shoulderWidth) {
      return this.restart('MOVING', geometry.shoulderCenter);
    }

    if (this.startedAt === null) {
      this.startedAt = timeMs;
      this.anchor = geometry.shoulderCenter;
    }
    this.samples.push(geometry);

    const progress = clamp((timeMs - this.startedAt) / this.cfg.durationMs, 0, 1);
    if (progress >= 1 && this.samples.length >= 8) {
      this.baselineResult = computeBaseline(this.samples, this.cfg);
      return { progress: 1, issue: null, done: true };
    }
    return { progress: Math.min(progress, 0.99), issue: null, done: false };
  }
}

/**
 * Slowly re-centres the neutral position while the player is idle, so a small
 * shuffle over a 70 s run does not turn into a permanent "lean".
 * Only applies when the deviation is already tiny — real attempts are never absorbed.
 */
export function adaptBaselineDrift(
  baseline: Baseline,
  geometry: BodyGeometry,
  dtMs: number,
  cfg: CalibrationConfig = GESTURE_CONFIG.calibration,
): void {
  const dx = geometry.shoulderCenter.x - baseline.shoulderCenter.x;
  const dy = geometry.shoulderCenter.y - baseline.shoulderCenter.y;
  const limit = cfg.driftAdaptMaxShift * baseline.scale;
  const alpha = 1 - Math.exp(-dtMs / cfg.driftAdaptTauMs);
  if (Math.abs(dx) < limit) {
    baseline.shoulderCenter.x += dx * alpha;
    baseline.nose.x += dx * alpha;
    if (baseline.hipCenter) baseline.hipCenter.x += dx * alpha;
  }
  if (Math.abs(dy) < limit) {
    baseline.shoulderCenter.y += dy * alpha;
    baseline.nose.y += dy * alpha;
  }
  // Hips carry the whole-body gestures (step / jump / squat): re-centre them the same way.
  if (baseline.hipCenter && geometry.hipCenter) {
    const hy = geometry.hipCenter.y - baseline.hipCenter.y;
    if (Math.abs(hy) < limit) baseline.hipCenter.y += hy * alpha;
  }
}
