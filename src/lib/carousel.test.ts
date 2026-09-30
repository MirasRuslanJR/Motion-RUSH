import { describe, expect, it } from 'vitest';
import { loopOffset, mod, releaseVelocity, swipeSteps } from './carousel';

describe('mode carousel', () => {
  it('loops endlessly: the first and last cards are neighbours', () => {
    expect(mod(-1, 13)).toBe(12);
    expect(loopOffset(12, 0, 13)).toBe(-1);
    expect(loopOffset(1, 12, 13)).toBe(2);
    expect(loopOffset(5, 5, 13)).toBe(0);
    for (let i = 0; i < 13; i++) expect(Math.abs(loopOffset(i, 3, 13))).toBeLessThanOrEqual(6.5);
  });

  it('a slow short drag snaps back, a longer one moves a card', () => {
    expect(swipeSteps(-40, 0, 360)).toBe(0);
    expect(swipeSteps(-200, 0, 360)).toBe(1);
    expect(swipeSteps(200, 0, 360)).toBe(-1);
  });

  it('a quick flick moves even when short, a long fling moves several cards (at most 3)', () => {
    expect(swipeSteps(-30, -0.8, 360)).toBe(1);
    expect(swipeSteps(30, 0.8, 360)).toBe(-1);
    expect(swipeSteps(-700, -1.5, 360)).toBe(3);
    expect(swipeSteps(-5, -2, 360)).toBe(1);
    expect(swipeSteps(-4, -2, 360)).toBe(1);
  });

  it('measures release speed from the last samples only', () => {
    const samples = [
      { x: 0, t: 0 },
      { x: 10, t: 300 },
      { x: 20, t: 340 },
      { x: 60, t: 380 },
    ];
    expect(releaseVelocity(samples)).toBeCloseTo((60 - 10) / 80);
    expect(releaseVelocity([])).toBe(0);
  });
});
