import { useEffect, useRef } from 'react';
import { lerp } from '../lib/math/geometry';
import { prefersReducedMotion } from '../lib/env';
import type { ExpectedMotion } from '../features/gestures/types';
import { observeCanvas } from '../features/render/canvas';
import { drawSkeleton, MotionTrail, type Projector } from '../features/render/skeletonRenderer';
import { createPose, LM } from '../features/tracking/landmarks';
import { buildSyntheticPose, type SyntheticPoseParams } from '../features/tracking/syntheticPose';

type Move = Exclude<ExpectedMotion, 'CENTER'>;

const TARGET: Record<Move, Partial<SyntheticPoseParams>> = {
  LEAN_LEFT: { leanDeg: -24 },
  LEAN_RIGHT: { leanDeg: 24 },
  JUMP: { leftArm: 1, rightArm: 1 },
  CROUCH: { crouch: 0.75 },
};

const CYCLE: Move[] = ['LEAN_LEFT', 'LEAN_RIGHT', 'JUMP', 'CROUCH'];
const STEP_MS = 1500;

function blend(target: Partial<SyntheticPoseParams>, t: number): Partial<SyntheticPoseParams> {
  const out: Partial<SyntheticPoseParams> = {};
  for (const [key, value] of Object.entries(target)) {
    if (typeof value === 'number') (out as Record<string, number>)[key] = lerp(0, value, t);
  }
  return out;
}

/** Ease in → hold → ease out, for one gesture repetition. */
function envelope(phase: number): number {
  if (phase < 0.3) return 0.5 - 0.5 * Math.cos((phase / 0.3) * Math.PI);
  if (phase < 0.7) return 1;
  if (phase < 0.95) return 0.5 + 0.5 * Math.cos(((phase - 0.7) / 0.25) * Math.PI);
  return 0;
}

interface DemoFigureProps {
  /** A single move to loop, or 'cycle' through all four. */
  move: Move | 'cycle';
  className?: string;
  onMoveChange?: (move: Move) => void;
  label?: string;
}

/** Animated synthetic skeleton that demonstrates a move (landing / tutorial). */
export function DemoFigure({ move, className, onMoveChange, label }: DemoFigureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onMoveRef = useRef(onMoveChange);
  useEffect(() => {
    onMoveRef.current = onMoveChange;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const sizing = observeCanvas(canvas);
    const pose = createPose();
    const trail = new MotionTrail([LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.NOSE], 14);
    const reduced = prefersReducedMotion();
    let raf = 0;
    let lastMove: Move | null = null;
    const start = performance.now();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const { width, height, dpr } = sizing.size;
      const elapsed = now - start;
      const index = Math.floor(elapsed / STEP_MS);
      const current: Move = move === 'cycle' ? (CYCLE[index % CYCLE.length] ?? 'JUMP') : move;
      if (current !== lastMove) {
        lastMove = current;
        onMoveRef.current?.(current);
      }
      const amount = reduced ? 1 : envelope((elapsed % STEP_MS) / STEP_MS);
      buildSyntheticPose({ cx: 0.5, cy: 0.36, sw: 0.14, ...blend(TARGET[current], amount) }, pose);

      const unit = Math.min(width, height);
      const ox = (width - unit) / 2;
      const oy = (height - unit) / 2;
      const p: Projector = { x: (v) => ox + v * unit, y: (v) => oy + v * unit, len: (v) => v * unit };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (!reduced) {
        trail.push(pose, p);
        trail.draw(ctx, '#2ee6ff', Math.max(2, unit * 0.008));
      }
      drawSkeleton(ctx, pose, p, {
        tone: amount > 0.95 ? 'success' : 'tracking',
        pulse: (now % 900) / 900,
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      sizing.dispose();
    };
  }, [move]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={label ?? 'Анимация движения'} />;
}
