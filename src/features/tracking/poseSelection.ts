import { TRACKING_CONFIG } from '../../config/tracking.config';
import type { Point } from '../../lib/math/geometry';
import { LM } from './landmarks';
import type { RawLandmark } from './LandmarkNormalizer';

export interface PoseSelection {
  /** Index of the pose that belongs to the player, -1 if none. */
  primaryIndex: number;
  /** Shoulder centre of the player in mirrored frame units. */
  primaryCenter: Point | null;
  /** Other people who are big and visible enough to matter. */
  significantOthers: number;
}

interface PoseSummary {
  center: Point;
  scale: number;
  visibility: number;
}

function summarize(raw: readonly RawLandmark[], aspect: number): PoseSummary | null {
  const ls = raw[LM.LEFT_SHOULDER];
  const rs = raw[LM.RIGHT_SHOULDER];
  if (!ls || !rs) return null;
  const lx = (1 - ls.x) * aspect;
  const rx = (1 - rs.x) * aspect;
  return {
    center: { x: (lx + rx) / 2, y: (ls.y + rs.y) / 2 },
    scale: Math.hypot(lx - rx, ls.y - rs.y),
    visibility: Math.min(ls.visibility ?? 1, rs.visibility ?? 1),
  };
}

/**
 * Keeps control stable when more than one person is in view:
 * the player is the pose closest to where the player was last frame
 * (identity continuity), or the largest pose on first detection.
 */
export function selectPrimaryPose(
  poses: readonly (readonly RawLandmark[])[],
  aspect: number,
  previousCenter: Point | null,
  cfg = TRACKING_CONFIG.multiPerson,
): PoseSelection {
  const summaries = poses.map((p) => summarize(p, aspect));
  let primaryIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  summaries.forEach((s, i) => {
    if (!s) return;
    const score = previousCenter
      ? Math.hypot(s.center.x - previousCenter.x, s.center.y - previousCenter.y)
      : -s.scale;
    if (score < bestScore) {
      bestScore = score;
      primaryIndex = i;
    }
  });

  const primary = primaryIndex >= 0 ? summaries[primaryIndex] : null;
  let significantOthers = 0;
  if (primary) {
    summaries.forEach((s, i) => {
      if (!s || i === primaryIndex) return;
      if (s.scale >= primary.scale * cfg.minRelativeScale && s.visibility >= cfg.minVisibility) {
        significantOthers++;
      }
    });
  }

  return { primaryIndex, primaryCenter: primary?.center ?? null, significantOthers };
}
