import { TRACKING_CONFIG } from '../../config/tracking.config';
import { Ema, OneEuroFilter, type OneEuroParams } from '../../lib/smoothing/filters';
import { createPose, POSE_LANDMARK_COUNT, type Pose } from './landmarks';

/**
 * Per-landmark One-Euro smoothing of x/y plus EMA on visibility.
 * Holds its own output buffer — callers must treat the returned pose as read-only
 * and copy it if they need to keep it past the next frame.
 */
export class MotionSmoother {
  private readonly fx: OneEuroFilter[] = [];
  private readonly fy: OneEuroFilter[] = [];
  private readonly fv: Ema[] = [];
  private readonly output: Pose = createPose();

  constructor(
    params: OneEuroParams = TRACKING_CONFIG.smoothing.landmarks,
    visibilityTauMs = TRACKING_CONFIG.smoothing.visibilityTauMs,
  ) {
    for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
      this.fx.push(new OneEuroFilter(params));
      this.fy.push(new OneEuroFilter(params));
      this.fv.push(new Ema(visibilityTauMs));
    }
  }

  /** Switch the x/y tuning (e.g. lighter smoothing when recognition runs slowly). */
  setParams(params: OneEuroParams): void {
    for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
      this.fx[i]?.setParams(params);
      this.fy[i]?.setParams(params);
    }
  }

  reset(): void {
    for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
      this.fx[i]?.reset();
      this.fy[i]?.reset();
      this.fv[i]?.reset();
    }
  }

  smooth(pose: Pose, timeMs: number): Pose {
    for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
      const src = pose[i];
      const dst = this.output[i];
      const fx = this.fx[i];
      const fy = this.fy[i];
      const fv = this.fv[i];
      if (!src || !dst || !fx || !fy || !fv) continue;
      dst.x = fx.filter(src.x, timeMs);
      dst.y = fy.filter(src.y, timeMs);
      dst.z = src.z;
      dst.v = fv.update(src.v, timeMs);
    }
    return this.output;
  }
}
