import { clamp } from '../lib/math/geometry';

export const RING_RADIUS = 44;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Imperative progress update — called from frame loops, not React renders. */
export function setRingProgress(circle: SVGCircleElement | null, progress: number): void {
  if (circle) circle.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamp(progress, 0, 1)));
}
