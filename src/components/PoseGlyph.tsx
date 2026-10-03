import type { DancePose } from '../features/dance/dance';

/** Arm end for a pose angle (0° down, 90° out, 180° up) — the same geometry as the dance cards. */
function armEnd(x: number, y: number, deg: number, outward: -1 | 1, length: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: x + outward * Math.sin(rad) * length, y: y + Math.cos(rad) * length };
}

/** Legs and a marker for the body part of a move: knees out in a squat, tucked in a jump, wide in a step. */
function legs(body: DancePose['body'], hipY: number, unit: number, ground: number): string {
  const mid = (hipY + ground) / 2;
  switch (body) {
    case 'squat':
      return `M24 ${hipY}L${24 - unit * 0.6} ${mid}L${24 - unit * 0.42} ${ground}M24 ${hipY}L${24 + unit * 0.6} ${mid}L${24 + unit * 0.42} ${ground}`;
    case 'jump':
      return `M24 ${hipY}L${24 - unit * 0.32} ${hipY + 6}L${24 - unit * 0.3} ${hipY + 11}M24 ${hipY}L${24 + unit * 0.32} ${hipY + 6}L${24 + unit * 0.3} ${hipY + 11}M17 ${hipY + 15}H22M26 ${hipY + 15}H31`;
    case 'step-left':
    case 'step-right': {
      const d = body === 'step-left' ? -1 : 1;
      return `M24 ${hipY}L${24 + d * 4} ${mid}L${24 + d * 7.5} ${ground}M24 ${hipY}L${24 - d * 1.2} ${mid}L${24 - d * 2.2} ${ground}`;
    }
    default:
      return `M24 ${hipY}L${24 - unit * 0.35} ${ground}M24 ${hipY}L${24 + unit * 0.35} ${ground}`;
  }
}

/**
 * A small stick figure of a dance move, mirrored like the camera picture:
 * the player's left arm is on the left. Whole-body moves show their legs and an arrow.
 */
export function PoseGlyph({ pose, size = 44 }: { pose: Pick<DancePose, 'left' | 'right' | 'body'>; size?: number }) {
  const unit = 10;
  const step = pose.body === 'step-left' ? -1 : pose.body === 'step-right' ? 1 : 0;
  // A step leaves room under the feet for its arrow.
  const ground = step ? 41 : 46;
  const top = pose.body === 'squat' ? 20 : pose.body === 'jump' ? 13 : step ? 14 : 17;
  const ls = { x: 24 - unit / 2, y: top };
  const rs = { x: 24 + unit / 2, y: top };
  const hipY = top + unit * (pose.body === 'squat' ? 1.1 : 1.3);
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
      <circle cx={24} cy={top - 8} r={4.5} />
      <path d={`M${ls.x} ${ls.y}H${rs.x}M24 ${ls.y}V${hipY}${legs(pose.body, hipY, unit, ground)}`} />
      <path d={`M${ls.x} ${ls.y}L${l.x} ${l.y}M${rs.x} ${rs.y}L${r.x} ${r.y}`} />
      {step !== 0 && <path d={`M${24 - step * 6} 45.5H${24 + step * 16}M${24 + step * 12.5} 43L${24 + step * 16} 45.5L${24 + step * 12.5} 48`} strokeWidth={2.4} />}
    </svg>
  );
}
