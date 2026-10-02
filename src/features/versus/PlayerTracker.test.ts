import { describe, expect, it } from 'vitest';
import { buildSyntheticPose, type SyntheticPoseParams } from '../tracking/syntheticPose';
import { PlayerTracker } from './PlayerTracker';

const ASPECT = 4 / 3;
const SW = 0.12;
const FRAME_MS = 33;

/** Feeds `frames` identical frames of a pose; returns the time reached. */
function feed(t: PlayerTracker, params: Partial<SyntheticPoseParams>, start: number, frames = 12): number {
  let now = start;
  for (let i = 0; i < frames; i++) {
    now += FRAME_MS;
    t.update(buildSyntheticPose({ cx: 0.3, cy: 0.35, sw: SW, ...params }), now);
  }
  return now;
}

describe('two-player tracker', () => {
  it('lanes are a short step from the spot the player calibrated on', () => {
    const p1 = new PlayerTracker(0, ASPECT);
    let now = feed(p1, {}, 0, 70);
    expect(p1.baseline).not.toBeNull();
    expect(p1.setupStatus).toBe('Готов!');
    expect(p1.input().lane).toBe(0);

    // A real step (0.8 shoulder widths ≈ 30 cm) to the left / right changes lane…
    now = feed(p1, { shift: -0.8 }, now);
    expect(p1.input().lane).toBe(-1);
    now = feed(p1, { shift: 0.8 }, now);
    expect(p1.input().lane).toBe(1);
    // …while swaying on the spot does not.
    feed(p1, { shift: 0.25 }, now);
    expect(p1.input().lane).toBe(0);
  });

  it('works the same wherever in their half the player stands', () => {
    // Player 2 standing off-centre in the right half: neutral is still the middle lane.
    const p2 = new PlayerTracker(1, ASPECT);
    const now = feed(p2, { cx: 1.1 }, 0, 70);
    expect(p2.baseline).not.toBeNull();
    expect(p2.input().lane).toBe(0);
    feed(p2, { cx: 1.1, shift: -0.8 }, now);
    expect(p2.input().lane).toBe(-1);
  });

  it('asks a player who stands at the middle line to step away before calibrating', () => {
    const p2 = new PlayerTracker(1, ASPECT);
    feed(p2, { cx: ASPECT / 2 + 0.05 }, 0, 70);
    expect(p2.tooCloseToMiddle).toBe(true);
    expect(p2.baseline).toBeNull();
    expect(p2.setupStatus).toBe('Отойди на шаг от середины');
  });
});
