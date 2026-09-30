import { clamp } from './math/geometry';

/** Always-positive modulo. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Signed distance of card `i` from the selected card on an endless loop of `n`
 * cards, in (-n/2, n/2]. Neighbours are ±1 even across the ends of the list,
 * so wrapping from the last card to the first is a one-card move.
 */
export function loopOffset(i: number, selected: number, n: number): number {
  const o = mod(i - selected, n);
  return o > n / 2 ? o - n : o;
}

/** How long (ms) a flick keeps travelling after release. */
const MOMENTUM_MS = 200;
/** A flick at least this fast (px/ms) always moves one card. */
const FLICK_SPEED = 0.45;

/**
 * Cards to move after a swipe: the drag distance plus momentum, snapped to
 * whole cards. Dragging left (negative) moves forward.
 */
export function swipeSteps(dragPx: number, velocity: number, stepPx: number, maxSteps = 3): number {
  if (stepPx <= 0) return 0;
  const projected = dragPx + velocity * MOMENTUM_MS;
  let steps = -Math.round(projected / stepPx);
  if (steps === 0 && Math.abs(velocity) >= FLICK_SPEED && Math.abs(dragPx) > 12) steps = velocity > 0 ? -1 : 1;
  return clamp(steps, -maxSteps, maxSteps);
}

/** Pointer velocity (px/ms) from recent samples, looking back `windowMs`. */
export function releaseVelocity(samples: readonly { x: number; t: number }[], windowMs = 90): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i];
    if (!s || last.t - s.t > windowMs) break;
    first = s;
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}
