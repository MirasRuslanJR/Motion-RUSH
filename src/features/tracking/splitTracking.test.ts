import { describe, expect, it } from 'vitest';
import { assignSides, cropToFrame, SPLIT_CROP, splitBySide, splitCrops } from './splitTracking';

/** 33 landmarks with the shoulders (11, 12) around `x`. */
function personAt(x: number) {
  return Array.from({ length: 33 }, (_, i) => ({ x: i === 11 ? x - 0.04 : i === 12 ? x + 0.04 : x, y: 0.5, z: 0.1, visibility: 1 }));
}

describe('two-player split tracking', () => {
  it('cuts the raw frame into two overlapping crops: P1 = right part (left of the mirrored screen)', () => {
    const [p1, p2] = splitCrops(640);
    const w = Math.round(640 * SPLIT_CROP);
    expect(p1).toEqual({ x0: 640 - w, width: w });
    expect(p2).toEqual({ x0: 0, width: w });
    // Both crops reach past the middle line.
    expect(p1.x0).toBeLessThan(320);
    expect(p2.x0 + p2.width).toBeGreaterThan(320);
  });

  it('maps crop coordinates back to the full frame', () => {
    const [p1] = splitCrops(1000);
    const pose = cropToFrame([{ x: 0, y: 0.3, z: 1, visibility: 1 }, { x: 1, y: 0.4, z: 0, visibility: 1 }], p1, 1000);
    expect(pose[0]?.x).toBeCloseTo(p1.x0 / 1000);
    expect(pose[1]?.x).toBeCloseTo(1);
    expect(pose[0]?.y).toBe(0.3);
    expect(pose[0]?.z).toBeCloseTo(p1.width / 1000);
  });

  it('keeps each player on their own side', () => {
    const left = personAt(0.75);
    const right = personAt(0.25);
    expect(assignSides(left, right)).toEqual([left, right]);
    // P1's crop found somebody who stands deep in P2's half → not P1.
    expect(assignSides(personAt(0.3), right)).toEqual([null, right]);
    expect(assignSides(left, personAt(0.8))).toEqual([left, null]);
  });

  it('counts one person seen by both crops once, for the side they stand on', () => {
    const a = personAt(0.52);
    const b = personAt(0.5);
    const [p1, p2] = assignSides(a, b);
    expect(p1).toBe(a);
    expect(p2).toBeNull();
    const [q1, q2] = assignSides(personAt(0.48), personAt(0.47));
    expect(q1).toBeNull();
    expect(q2).not.toBeNull();
  });

  it('fallback by side never gives one person to both players', () => {
    const aspect = 4 / 3;
    // Two candidates on the left: the one nearer the half's centre (aspect / 4) wins.
    const p1 = personAt(0.33);
    const duplicate = personAt(0.4);
    expect(splitBySide([duplicate, p1], aspect)).toEqual([p1, null]);
    const p2 = personAt(1.0);
    expect(splitBySide([p2, p1], aspect)).toEqual([p1, p2]);
  });
});
