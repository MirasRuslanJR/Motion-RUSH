import { distance, midpoint, type Point } from '../../lib/math/geometry';
import { LM, lm, SKELETON_BONES, SKELETON_JOINTS, type Pose } from '../tracking/landmarks';
import { PALETTE, rgba } from './palette';

/** Converts pose units to canvas pixels. */
export interface Projector {
  x(value: number): number;
  y(value: number): number;
  /** Pixels per pose unit (for sizes). */
  len(value: number): number;
}

export type SkeletonTone = 'tracking' | 'success' | 'ghost' | 'dim';

export interface SkeletonDrawOptions {
  tone: SkeletonTone;
  /** Joints of the active gesture, drawn brighter. */
  highlight?: readonly number[];
  /** Joints the error-mode hint refers to, drawn pulsing warm. */
  errorJoints?: readonly number[];
  /** 0..1 looping phase for pulses. */
  pulse?: number;
  alpha?: number;
}

const ARM_JOINTS = new Set<number>([
  LM.LEFT_SHOULDER,
  LM.LEFT_ELBOW,
  LM.LEFT_WRIST,
  LM.LEFT_INDEX,
  LM.RIGHT_SHOULDER,
  LM.RIGHT_ELBOW,
  LM.RIGHT_WRIST,
  LM.RIGHT_INDEX,
]);
const LEG_JOINTS = new Set<number>([LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE]);

function boneColor(a: number, b: number, tone: SkeletonTone): string {
  if (tone === 'success') return PALETTE.success;
  if (tone === 'ghost') return PALETTE.white;
  if (ARM_JOINTS.has(a) && ARM_JOINTS.has(b) && !(a === LM.LEFT_SHOULDER && b === LM.RIGHT_SHOULDER)) return PALETTE.cyan;
  if (LEG_JOINTS.has(a) || LEG_JOINTS.has(b)) return PALETTE.violet;
  return PALETTE.white;
}

export function drawSkeleton(ctx: CanvasRenderingContext2D, pose: Pose, p: Projector, opts: SkeletonDrawOptions): void {
  const alpha = opts.alpha ?? 1;
  const pulse = opts.pulse ?? 0;
  const ls = lm(pose, LM.LEFT_SHOULDER);
  const rs = lm(pose, LM.RIGHT_SHOULDER);
  const unit = Math.max(p.len(distance(ls, rs)), 8);
  const width = Math.max(2, unit * 0.055);
  const highlight = new Set(opts.highlight ?? []);
  const errors = new Set(opts.errorJoints ?? []);
  const ghost = opts.tone === 'ghost';

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (ghost) ctx.setLineDash([width * 2.2, width * 1.8]);

  // Bones: soft wide glow pass + crisp core pass.
  for (const pass of ghost ? [1] : [0, 1]) {
    ctx.globalCompositeOperation = pass === 0 ? 'lighter' : 'source-over';
    for (const [ia, ib] of SKELETON_BONES) {
      const a = lm(pose, ia);
      const b = lm(pose, ib);
      const vis = Math.min(a.v, b.v);
      if (vis < 0.25) continue;
      const lit = highlight.has(ia) && highlight.has(ib);
      const err = errors.has(ia) && errors.has(ib);
      const color = err ? PALETTE.error : lit && opts.tone !== 'success' ? PALETTE.cyan : boneColor(ia, ib, opts.tone);
      const visAlpha = vis < 0.5 ? 0.3 : 1;
      if (pass === 0) {
        ctx.strokeStyle = rgba(color, 0.16 * alpha * visAlpha * (lit || err ? 1.8 : 1));
        ctx.lineWidth = width * (lit || err ? 4.2 : 3.2);
      } else {
        ctx.strokeStyle = rgba(color, (ghost ? 0.6 : 0.95) * alpha * visAlpha * (opts.tone === 'dim' ? 0.45 : 1));
        ctx.lineWidth = width * (lit || err ? 1.35 : 1);
      }
      ctx.beginPath();
      ctx.moveTo(p.x(a.x), p.y(a.y));
      ctx.lineTo(p.x(b.x), p.y(b.y));
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // Head ring anchored between the eyes and the nose.
  const nose = lm(pose, LM.NOSE);
  if (nose.v > 0.3) {
    const headCenter = midpoint(nose, midpoint(lm(pose, LM.LEFT_EYE), lm(pose, LM.RIGHT_EYE)));
    const headErr = errors.has(LM.NOSE);
    ctx.strokeStyle = rgba(headErr ? PALETTE.error : opts.tone === 'success' ? PALETTE.success : PALETTE.white, (ghost ? 0.5 : 0.85) * alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(p.x(headCenter.x), p.y(headCenter.y), unit * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Joints.
  for (const index of SKELETON_JOINTS) {
    const j = lm(pose, index);
    if (j.v < 0.35) continue;
    const x = p.x(j.x);
    const y = p.y(j.y);
    const r = width * (ghost ? 1.1 : 1.35);
    if (errors.has(index)) {
      const pr = r * (2.2 + Math.sin(pulse * Math.PI * 2) * 0.8);
      ctx.fillStyle = rgba(PALETTE.error, 0.28 * alpha);
      ctx.beginPath();
      ctx.arc(x, y, pr * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(PALETTE.error, alpha);
    } else if (highlight.has(index)) {
      ctx.fillStyle = rgba(opts.tone === 'success' ? PALETTE.success : PALETTE.cyan, 0.25 * alpha);
      ctx.beginPath();
      ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(PALETTE.white, alpha);
    } else {
      ctx.fillStyle = rgba(ghost ? PALETTE.white : PALETTE.white, (ghost ? 0.55 : 0.9) * alpha);
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, color: string, size: number, alpha = 1): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < size * 1.5) return;
  const ux = dx / len;
  const uy = dy / len;
  ctx.save();
  ctx.strokeStyle = rgba(color, alpha);
  ctx.fillStyle = rgba(color, alpha);
  ctx.lineWidth = Math.max(2, size * 0.28);
  ctx.lineCap = 'round';
  ctx.setLineDash([size * 0.5, size * 0.45]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x - ux * size, to.y - uy * size);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - ux * size - uy * size * 0.6, to.y - uy * size + ux * size * 0.6);
  ctx.lineTo(to.x - ux * size + uy * size * 0.6, to.y - uy * size - ux * size * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Short fading light trail behind selected joints — the app's visual motif. */
export class MotionTrail {
  private readonly joints: readonly number[];
  private readonly length: number;
  private readonly history: Point[][];
  private cursor = 0;
  private filled = 0;

  constructor(joints: readonly number[], length = 10) {
    this.joints = joints;
    this.length = length;
    this.history = joints.map(() => Array.from({ length }, () => ({ x: 0, y: 0 })));
  }

  clear(): void {
    this.filled = 0;
  }

  /** Record screen-space positions (call once per rendered frame). */
  push(pose: Pose, p: Projector): void {
    this.joints.forEach((index, j) => {
      const slot = this.history[j]?.[this.cursor];
      const point = pose[index];
      if (!slot || !point) return;
      slot.x = p.x(point.x);
      slot.y = p.y(point.y);
    });
    this.cursor = (this.cursor + 1) % this.length;
    this.filled = Math.min(this.filled + 1, this.length);
  }

  draw(ctx: CanvasRenderingContext2D, color: string, width: number, alpha = 1): void {
    if (this.filled < 3) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const points of this.history) {
      for (let k = 1; k < this.filled; k++) {
        const i0 = (this.cursor - this.filled + k - 1 + this.length * 2) % this.length;
        const i1 = (this.cursor - this.filled + k + this.length * 2) % this.length;
        const a = points[i0];
        const b = points[i1];
        if (!a || !b) continue;
        const t = k / this.filled;
        ctx.strokeStyle = rgba(color, 0.5 * t * alpha);
        ctx.lineWidth = width * (0.3 + t);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
