import { midpoint, type Point } from '../../lib/math/geometry';
import type { MotionFrame } from '../engine/MotionEngine';
import { isErrorVerdict } from '../gestures/ErrorDiagnosisEngine';
import { targetGuides } from '../gestures/targetPose';
import type { GestureType } from '../gestures/types';
import { BODY_PART_JOINTS, LM, lm, type BodyPart, type Pose } from '../tracking/landmarks';
import { coverMapping, mapLen, mapX, mapY, observeCanvas, type ViewMapping } from './canvas';
import { PALETTE, rgba } from './palette';
import { drawArrow, drawSkeleton, MotionTrail, type Projector } from './skeletonRenderer';

const GESTURE_PARTS: Record<GestureType, BodyPart[]> = {
  LEAN_LEFT: ['shoulders', 'torso'],
  LEAN_RIGHT: ['shoulders', 'torso'],
  JUMP: ['leftArm', 'rightArm'],
  CROUCH: ['hips', 'legs'],
};

function joints(parts: readonly BodyPart[]): number[] {
  const out = new Set<number>();
  for (const part of parts) for (const j of BODY_PART_JOINTS[part]) out.add(j);
  return [...out];
}

export interface OverlayOptions {
  /** Draw error-mode guidance: ghost pose, target lines, arrows. */
  guidance: boolean;
  /** Draw the light trail behind hands and head. */
  trail: boolean;
}

/**
 * Draws on top of the mirrored camera feed: the live skeleton, gesture
 * highlights, and — in error mode — the ghost target pose, threshold lines
 * and arrows from the current joint to where it must go.
 */
export class CameraOverlayRenderer {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sizing: ReturnType<typeof observeCanvas>;
  private readonly trail = new MotionTrail([LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.NOSE], 9);
  private mapping: ViewMapping = coverMapping(1, 1, 640, 480);
  private readonly projector: Projector = {
    x: (v) => mapX(v, this.mapping),
    y: (v) => mapY(v, this.mapping),
    len: (v) => mapLen(v, this.mapping),
  };

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.sizing = observeCanvas(canvas);
  }

  dispose(): void {
    this.sizing.dispose();
  }

  render(frame: Readonly<MotionFrame>, now: number, opts: OverlayOptions): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width, height, dpr } = this.sizing.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const pose = frame.pose;
    if (!pose) {
      this.trail.clear();
      return;
    }
    this.mapping = coverMapping(width, height, frame.videoWidth, frame.videoHeight);
    const pulse = (now % 900) / 900;

    const diagnosis = frame.diagnosis;
    const errorMode = opts.guidance && diagnosis !== null && isErrorVerdict(diagnosis.verdict);
    const success = diagnosis?.verdict === 'correct';

    const highlight: BodyPart[] = [];
    if (frame.lateral.phase === 'CONFIRMED' && frame.lateral.gesture) highlight.push(...GESTURE_PARTS[frame.lateral.gesture]);
    if (frame.vertical.phase === 'CONFIRMED' && frame.vertical.gesture) highlight.push(...GESTURE_PARTS[frame.vertical.gesture]);
    if (diagnosis && diagnosis.verdict === 'idle' && opts.guidance) highlight.push(...diagnosis.focus);

    if (opts.trail) {
      this.trail.push(pose, this.projector);
      this.trail.draw(ctx, success ? PALETTE.success : PALETTE.cyan, Math.max(2, this.projector.len(0.006)));
    }

    if (opts.guidance && diagnosis && frame.baseline && frame.expected && !success) {
      this.drawGuides(ctx, frame, pose, width, height);
      if (frame.target) {
        drawSkeleton(ctx, frame.target, this.projector, { tone: 'ghost', alpha: 0.9 });
        this.drawCorrectionArrows(ctx, pose, frame.target, diagnosis.verdict === 'idle' ? PALETTE.cyan : PALETTE.warn);
      }
    }

    drawSkeleton(ctx, pose, this.projector, {
      tone: !frame.trackable ? 'dim' : success ? 'success' : 'tracking',
      highlight: joints(highlight),
      errorJoints: errorMode && diagnosis ? joints(diagnosis.focus) : [],
      pulse,
    });
  }

  private drawGuides(ctx: CanvasRenderingContext2D, frame: Readonly<MotionFrame>, pose: Pose, width: number, height: number): void {
    const baseline = frame.baseline;
    const expected = frame.expected;
    if (!baseline || !expected) return;
    const shoulderY = midpoint(lm(pose, LM.LEFT_SHOULDER), lm(pose, LM.RIGHT_SHOULDER)).y;
    ctx.save();
    ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'bottom';
    for (const guide of targetGuides(expected, baseline, shoulderY)) {
      ctx.strokeStyle = rgba(PALETTE.cyan, 0.75);
      ctx.fillStyle = rgba(PALETTE.cyan, 0.95);
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      if (guide.orientation === 'horizontal') {
        const y = this.projector.y(guide.value);
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        if (guide.label) ctx.fillText(guide.label, 12, y - 6);
      } else {
        const x = this.projector.x(guide.value);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        if (guide.label) {
          const tw = ctx.measureText(guide.label).width;
          ctx.fillText(guide.label, Math.min(Math.max(x - tw / 2, 8), width - tw - 8), 24);
        }
      }
    }
    ctx.restore();
  }

  private drawCorrectionArrows(ctx: CanvasRenderingContext2D, pose: Pose, target: Pose, color: string): void {
    const size = Math.max(10, this.projector.len(0.03));
    const toScreen = (p: Point): Point => ({ x: this.projector.x(p.x), y: this.projector.y(p.y) });
    const pairs: Array<[Point, Point]> = [];
    for (const index of [LM.LEFT_WRIST, LM.RIGHT_WRIST]) {
      pairs.push([lm(pose, index), lm(target, index)]);
    }
    pairs.push([
      midpoint(lm(pose, LM.LEFT_SHOULDER), lm(pose, LM.RIGHT_SHOULDER)),
      midpoint(lm(target, LM.LEFT_SHOULDER), lm(target, LM.RIGHT_SHOULDER)),
    ]);
    for (const [from, to] of pairs) {
      const a = toScreen(from);
      const b = toScreen(to);
      if (Math.hypot(b.x - a.x, b.y - a.y) > size * 2.2) drawArrow(ctx, a, b, color, size, 0.95);
    }
  }
}
