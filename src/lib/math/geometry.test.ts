import { describe, expect, it } from 'vitest';
import {
  angle,
  clamp,
  distance,
  inverseLerp,
  isAbove,
  isBelow,
  isLeftOf,
  isRightOf,
  median,
  midpoint,
  normalizeByBodyScale,
  rotateAround,
  tiltFromVertical,
} from './geometry';

describe('geometry', () => {
  it('distance / midpoint', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpoint({ x: 0, y: 2 }, { x: 4, y: 6 })).toEqual({ x: 2, y: 4 });
  });

  it('angle at a vertex', () => {
    expect(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(angle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180);
    expect(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
    expect(angle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
  });

  it('tilt from vertical is signed toward +x', () => {
    expect(tiltFromVertical({ x: 0, y: 1 }, { x: 0, y: 0 })).toBeCloseTo(0);
    expect(tiltFromVertical({ x: 0, y: 1 }, { x: 1, y: 0 })).toBeCloseTo(45);
    expect(tiltFromVertical({ x: 0, y: 1 }, { x: -1, y: 0 })).toBeCloseTo(-45);
  });

  it('screen-space comparisons (y grows downward)', () => {
    const hand = { x: 0.2, y: 0.1 };
    const shoulder = { x: 0.3, y: 0.4 };
    expect(isAbove(hand, shoulder)).toBe(true);
    expect(isAbove(hand, shoulder, 0.5)).toBe(false);
    expect(isBelow(shoulder, hand)).toBe(true);
    expect(isLeftOf(hand, shoulder)).toBe(true);
    expect(isRightOf(hand, shoulder)).toBe(false);
  });

  it('normalizes by body scale and guards zero scale', () => {
    expect(normalizeByBodyScale(0.1, 0.2)).toBeCloseTo(0.5);
    expect(normalizeByBodyScale(0.1, 0)).toBe(0);
  });

  it('rotates around a pivot clockwise on screen for positive degrees', () => {
    const r = rotateAround({ x: 0, y: -1 }, { x: 0, y: 0 }, 90);
    expect(r.x).toBeCloseTo(1);
    expect(r.y).toBeCloseTo(0);
  });

  it('median / clamp / inverseLerp', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(inverseLerp(0, 10, 2.5)).toBe(0.25);
    expect(inverseLerp(3, 3, 7)).toBe(0);
  });
});
