/**
 * 2D geometry helpers used by the motion pipeline.
 *
 * Coordinate convention (matches screen / canvas space):
 *   x grows to the right, y grows DOWNWARD — so "above" means a smaller y.
 */

export interface Point {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Position of `value` between `a` and `b` as a fraction (unclamped). */
export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Interior angle at vertex `b` of the polyline a-b-c, in degrees [0, 180]. */
export function angle(a: Point, b: Point, c: Point): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const norm = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (norm === 0) return 0;
  const cos = clamp((v1x * v2x + v1y * v2y) / norm, -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Signed tilt of the segment `from → to` relative to the vertical "up" axis,
 * in degrees. 0 = perfectly upright, positive = top leans toward +x.
 */
export function tiltFromVertical(from: Point, to: Point): number {
  return (Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI;
}

/** Signed angle of the line a → b from horizontal, degrees. Positive = b is lower. */
export function lineTilt(a: Point, b: Point): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Express a raw distance in body units (e.g. shoulder widths). */
export function normalizeByBodyScale(value: number, bodyScale: number): number {
  return bodyScale > 1e-6 ? value / bodyScale : 0;
}

export function isAbove(a: Point, b: Point, margin = 0): boolean {
  return a.y < b.y - margin;
}

export function isBelow(a: Point, b: Point, margin = 0): boolean {
  return a.y > b.y + margin;
}

export function isLeftOf(a: Point, b: Point, margin = 0): boolean {
  return a.x < b.x - margin;
}

export function isRightOf(a: Point, b: Point, margin = 0): boolean {
  return a.x > b.x + margin;
}

export function rotateAround(p: Point, pivot: Point, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}
