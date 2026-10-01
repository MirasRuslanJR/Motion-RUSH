import type { RawLandmark } from './LandmarkNormalizer';

/**
 * Two players at one camera.
 *
 * MediaPipe with numPoses: 2 sometimes tracks the SAME person twice — and once
 * it "has" two poses it stops running the person detector, so the second player
 * is never found. Instead the picture is cut into two slightly overlapping crops
 * and each crop gets its own single-person tracker (the same setup that works so
 * well in single-player mode).
 *
 * Coordinates here are the raw camera image (not mirrored): the player on the
 * LEFT of the mirrored screen (P1) stands in the RIGHT part of the raw image.
 */

/** Share of the frame width each crop covers (a little past the middle line). */
export const SPLIT_CROP = 0.56;
/** A player may lean this far (share of frame width) over the middle line. */
const SIDE_TOLERANCE = 0.04;
/** Results closer than this (share of frame width) are one person seen by both crops. */
const SAME_PERSON = 0.08;

/** How two-player tracking currently runs. */
export type TwoPlayerTracking = 'off' | 'loading' | 'split' | 'shared';

export interface CropRect {
  /** Left edge in source pixels. */
  x0: number;
  width: number;
}

/** Crops for [P1, P2] in raw image pixels. */
export function splitCrops(frameWidth: number): [CropRect, CropRect] {
  const width = Math.round(frameWidth * SPLIT_CROP);
  return [
    { x0: frameWidth - width, width },
    { x0: 0, width },
  ];
}

/** Crop-normalised landmarks → full-frame-normalised (in place). */
export function cropToFrame<T extends RawLandmark[]>(pose: T, crop: CropRect, frameWidth: number): T {
  const k = crop.width / frameWidth;
  const offset = crop.x0 / frameWidth;
  for (const l of pose) {
    l.x = offset + l.x * k;
    l.z *= k;
  }
  return pose;
}

function shoulderCenterX(pose: readonly { x: number }[]): number | null {
  const ls = pose[11];
  const rs = pose[12];
  return ls && rs ? (ls.x + rs.x) / 2 : null;
}

/**
 * Validates the two crop results (raw image coordinates): each player must stand
 * on their own side (P1: x > 0.5), and one person seen by both crops counts once —
 * for the side they actually stand on.
 */
export function assignSides<T extends readonly { x: number }[]>(p1: T | null, p2: T | null): [T | null, T | null] {
  const c1 = p1 ? shoulderCenterX(p1) : null;
  const c2 = p2 ? shoulderCenterX(p2) : null;
  let a = c1 !== null && c1 >= 0.5 - SIDE_TOLERANCE ? p1 : null;
  let b = c2 !== null && c2 <= 0.5 + SIDE_TOLERANCE ? p2 : null;
  if (a && b && c1 !== null && c2 !== null && Math.abs(c1 - c2) < SAME_PERSON) {
    if ((c1 + c2) / 2 >= 0.5) b = null;
    else a = null;
  }
  return [a, b];
}

/**
 * Fallback when only one shared tracker is available (mirrored display
 * coordinates, x in 0..aspect): P1 is the person in the left half, P2 in the
 * right half. One person is never given to both slots — with two candidates on
 * one side, the one nearer that half's centre wins and the other slot stays empty.
 */
export function splitBySide<T extends readonly { x: number }[]>(people: readonly T[], aspect: number): [T | null, T | null] {
  const best: [T | null, T | null] = [null, null];
  const dist = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  for (const p of people) {
    const x = shoulderCenterX(p);
    if (x === null) continue;
    const side = x < aspect / 2 ? 0 : 1;
    const d = Math.abs(x - aspect * (side === 0 ? 0.25 : 0.75));
    if (d < (dist[side] ?? 0)) {
      dist[side] = d;
      best[side] = p;
    }
  }
  return best;
}
