import { describe, expect, it } from 'vitest';
import { LANDMARK_STRIDE, packPoses, unpackPoses } from './landmarkPacking';
import type { RawLandmark } from './LandmarkNormalizer';

const pose = (seed: number): RawLandmark[] =>
  Array.from({ length: 33 }, (_, i) => ({ x: seed + i * 0.01, y: 0.5 - i * 0.01, z: -i * 0.001, visibility: (i % 10) / 10 }));

describe('landmark packing (worker → main thread transfer)', () => {
  it('round-trips several poses', () => {
    const poses = [pose(0.1), pose(0.6)];
    const data = packPoses(poses);
    expect(data.length).toBe(2 * 33 * LANDMARK_STRIDE);
    const back = unpackPoses(data, 2);
    expect(back).toHaveLength(2);
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < 33; i++) {
        const a = poses[p]?.[i];
        const b = back[p]?.[i];
        expect(b?.x).toBeCloseTo(a?.x ?? NaN, 5);
        expect(b?.y).toBeCloseTo(a?.y ?? NaN, 5);
        expect(b?.visibility).toBeCloseTo(a?.visibility ?? NaN, 5);
      }
    }
  });

  it('handles "nobody in frame" and defaults missing visibility to 1', () => {
    expect(unpackPoses(packPoses([]), 0)).toEqual([]);
    const data = packPoses([[{ x: 0.2, y: 0.3, z: 0 }]], 1);
    expect(unpackPoses(data, 1, [], 1)[0]?.[0]?.visibility).toBe(1);
  });

  it('reuses pooled objects between results (no per-frame allocation)', () => {
    const pool: RawLandmark[][] = [];
    const first = unpackPoses(packPoses([pose(0.1)]), 1, pool);
    const second = unpackPoses(packPoses([pose(0.3)]), 1, pool);
    expect(second[0]).toBe(first[0]);
    expect(second[0]?.[0]?.x).toBeCloseTo(0.3, 5);
  });
});
