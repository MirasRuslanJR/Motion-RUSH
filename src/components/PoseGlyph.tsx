import type { DancePose } from '../features/dance/dance';

/** Arm end for a pose angle (0° down, 90° out, 180° up) — the same geometry as the dance cards. */
function armEnd(x: number, y: number, deg: number, outward: -1 | 1, length: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: x + outward * Math.sin(rad) * length, y: y + Math.cos(rad) * length };
}

/**
 * A small stick figure of a dance pose, mirrored like the camera picture:
 * the player's left arm is on the left.
 */
export function PoseGlyph({ pose, size = 44 }: { pose: Pick<DancePose, 'left' | 'right'>; size?: number }) {
  const unit = 10;
  const ls = { x: 24 - unit / 2, y: 17 };
  const rs = { x: 24 + unit / 2, y: 17 };
  const hipY = ls.y + unit * 1.35;
  const l = armEnd(ls.x, ls.y, pose.left, -1, unit * 1.45);
  const r = armEnd(rs.x, rs.y, pose.right, 1, unit * 1.45);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={24} cy={9} r={4.5} />
      <path d={`M${ls.x} ${ls.y}H${rs.x}M24 ${ls.y}V${hipY}L${24 - unit * 0.35} ${hipY + unit * 1.3}M24 ${hipY}L${24 + unit * 0.35} ${hipY + unit * 1.3}`} />
      <path d={`M${ls.x} ${ls.y}L${l.x} ${l.y}M${rs.x} ${rs.y}L${r.x} ${r.y}`} />
    </svg>
  );
}
