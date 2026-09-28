import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from '../../lib/smoothing/filters';
import { ASPECT, makePose } from '../../test/fixtures';
import { assessFrame, isTrackable } from './frameQuality';
import { normalizeLandmarks } from './LandmarkNormalizer';
import { LM, lm } from './landmarks';
import { selectPrimaryPose } from './poseSelection';

describe('LandmarkNormalizer', () => {
  it('mirrors x and scales it by the aspect ratio', () => {
    const raw = Array.from({ length: 33 }, () => ({ x: 0.25, y: 0.5, z: 0, visibility: 0.9 }));
    const pose = normalizeLandmarks(raw, ASPECT);
    expect(lm(pose, 0).x).toBeCloseTo(0.75 * ASPECT);
    expect(lm(pose, 0).y).toBe(0.5);
    expect(lm(pose, 0).v).toBe(0.9);
  });

  it('can skip mirroring and zeroes missing landmarks', () => {
    const pose = normalizeLandmarks([{ x: 0.25, y: 0.5, z: 0 }], 1, false);
    expect(lm(pose, 0).x).toBe(0.25);
    expect(lm(pose, 0).v).toBe(1);
    expect(lm(pose, 5).v).toBe(0);
  });
});

describe('frame quality', () => {
  it('accepts a well-framed player', () => {
    const q = assessFrame(makePose(), ASPECT);
    expect(q.status).toBe('OK');
    expect(q.hipsVisible).toBe(true);
    expect(isTrackable(q.status)).toBe(true);
  });

  it('reports why a frame is unusable', () => {
    expect(assessFrame(null, ASPECT).status).toBe('NO_BODY');
    expect(assessFrame(makePose({ visibility: 0.3 }), ASPECT).status).toBe('PARTIAL');
    expect(assessFrame(makePose({ sw: 0.5 }), ASPECT).status).toBe('TOO_CLOSE');
    expect(assessFrame(makePose({ sw: 0.05 }), ASPECT).status).toBe('TOO_FAR');
    const left = assessFrame(makePose({ cx: 0.08 }), ASPECT);
    expect(left.status).toBe('OFF_CENTER');
    expect(left.moveDirection).toBe(1);
  });

  it('flags missing headroom for raised hands', () => {
    expect(assessFrame(makePose({ cy: 0.2, sw: 0.18 }), ASPECT).lowHeadroom).toBe(true);
    expect(assessFrame(makePose(), ASPECT).lowHeadroom).toBe(false);
  });

  it('detects upper-body framing', () => {
    expect(assessFrame(makePose({ lowerBodyVisible: false }), ASPECT).hipsVisible).toBe(false);
  });
});

describe('pose selection', () => {
  const toRaw = (cx: number, sw: number) =>
    makePose({ cx, sw }).map((p) => ({ x: 1 - p.x / ASPECT, y: p.y, z: 0, visibility: p.v }));

  it('keeps following the same player and counts bystanders', () => {
    const player = toRaw(0.5, 0.16);
    const bystander = toRaw(1.0, 0.15);
    const first = selectPrimaryPose([bystander, player], ASPECT, null);
    expect(first.significantOthers).toBe(1);
    const followed = selectPrimaryPose([bystander, player], ASPECT, { x: 0.5, y: 0.42 });
    expect(followed.primaryIndex).toBe(1);
  });

  it('treats an overlapping duplicate detection as the same player', () => {
    const res = selectPrimaryPose([toRaw(0.66, 0.16), toRaw(0.7, 0.15)], ASPECT, null);
    expect(res.significantOthers).toBe(0);
  });

  it('ignores small background people', () => {
    const res = selectPrimaryPose([toRaw(0.6, 0.16), toRaw(1.1, 0.05)], ASPECT, null);
    expect(res.primaryIndex).toBe(0);
    expect(res.significantOthers).toBe(0);
  });
});

describe('OneEuroFilter', () => {
  it('suppresses jitter at rest but follows a real step', () => {
    const f = new OneEuroFilter({ minCutoff: 1.4, beta: 3, dCutoff: 1 });
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(i % 2 === 0 ? 0.505 : 0.495, i * 33);
    expect(Math.abs(out - 0.5)).toBeLessThan(0.004);
    for (let i = 60; i < 75; i++) out = f.filter(0.8, i * 33);
    expect(out).toBeGreaterThan(0.75);
  });
});

describe('synthetic pose sanity', () => {
  it('places anatomical left on screen left (mirror space)', () => {
    const pose = makePose();
    expect(lm(pose, LM.LEFT_SHOULDER).x).toBeLessThan(lm(pose, LM.RIGHT_SHOULDER).x);
  });
});
