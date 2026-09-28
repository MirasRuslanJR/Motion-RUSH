import { createPose, type Pose } from './landmarks';

/** Shape of a MediaPipe NormalizedLandmark (kept structural to avoid coupling). */
export interface RawLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/**
 * Converts MediaPipe image-normalized landmarks ([0,1] per axis, camera view)
 * into mirrored frame units: x' = (1 - x) · aspect, y' = y.
 *
 * Mirroring makes the screen behave like a mirror: when the user leans to their
 * left, everything moves to the screen's left — for skeleton, gestures and game.
 */
export function normalizeLandmarks(
  raw: readonly RawLandmark[],
  aspect: number,
  mirror = true,
  out: Pose = createPose(),
): Pose {
  for (let i = 0; i < out.length; i++) {
    const src = raw[i];
    const dst = out[i];
    if (!dst) continue;
    if (!src) {
      dst.x = 0;
      dst.y = 0;
      dst.z = 0;
      dst.v = 0;
      continue;
    }
    dst.x = (mirror ? 1 - src.x : src.x) * aspect;
    dst.y = src.y;
    dst.z = src.z;
    dst.v = src.visibility ?? 1;
  }
  return out;
}
