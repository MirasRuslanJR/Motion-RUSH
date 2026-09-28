import type { RawLandmark } from './LandmarkNormalizer';
import { POSE_LANDMARK_COUNT } from './landmarks';

/** x, y, z, visibility per landmark. */
export const LANDMARK_STRIDE = 4;

/**
 * Flattens poses into one Float32Array so a worker can hand results to the
 * main thread as a transferable buffer (zero-copy, no structured-clone of objects).
 */
export function packPoses(poses: readonly (readonly RawLandmark[])[], perPose = POSE_LANDMARK_COUNT): Float32Array {
  const data = new Float32Array(poses.length * perPose * LANDMARK_STRIDE);
  poses.forEach((pose, p) => {
    for (let i = 0; i < perPose; i++) {
      const l = pose[i];
      if (!l) continue;
      const o = (p * perPose + i) * LANDMARK_STRIDE;
      data[o] = l.x;
      data[o + 1] = l.y;
      data[o + 2] = l.z;
      data[o + 3] = l.visibility ?? 1;
    }
  });
  return data;
}

/**
 * Inverse of packPoses. Reuses `pool` objects across calls to keep the
 * 30 Hz result stream allocation-free after warm-up.
 */
export function unpackPoses(
  data: Float32Array,
  count: number,
  pool: RawLandmark[][] = [],
  perPose = POSE_LANDMARK_COUNT,
): RawLandmark[][] {
  const out: RawLandmark[][] = [];
  for (let p = 0; p < count; p++) {
    let pose = pool[p];
    if (!pose) {
      pose = Array.from({ length: perPose }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
      pool[p] = pose;
    }
    for (let i = 0; i < perPose; i++) {
      const l = pose[i];
      if (!l) continue;
      const o = (p * perPose + i) * LANDMARK_STRIDE;
      l.x = data[o] ?? 0;
      l.y = data[o + 1] ?? 0;
      l.z = data[o + 2] ?? 0;
      l.visibility = data[o + 3] ?? 0;
    }
    out.push(pose);
  }
  return out;
}
