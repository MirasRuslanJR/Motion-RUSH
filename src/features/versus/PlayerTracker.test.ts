import { describe, expect, it } from 'vitest';
import { buildSyntheticPose, type SyntheticPoseParams } from '../tracking/syntheticPose';
import { PlayerTracker } from './PlayerTracker';

const ASPECT = 4 / 3;
const SW = 0.12;
const FRAME_MS = 33;

/** Feeds `frames` identical frames of a pose; returns the time reached. */
function feed(t: PlayerTracker, params: Partial<SyntheticPoseParams>, start: number, frames = 12, aspect = ASPECT): number {
  let now = start;
  for (let i = 0; i < frames; i++) {
    now += FRAME_MS;
    t.update(buildSyntheticPose({ cx: 0.3, cy: 0.35, sw: SW, ...params }), now, aspect);
  }
  return now;
}

describe('two-player tracker', () => {
  it('a lean or one small step changes lane, swaying does not', () => {
    const p1 = new PlayerTracker(0);
    let now = feed(p1, {}, 0, 70);
    expect(p1.baseline).not.toBeNull();
    expect(p1.setupStatus).toBe('Готов!');
    expect(p1.standZone).toBeNull();
    expect(p1.input().lane).toBe(0);

    // Leaning the torso — the feet stay where they are.
    now = feed(p1, { leanDeg: -25 }, now);
    expect(p1.input().lane).toBe(-1);
    now = feed(p1, { leanDeg: 25 }, now);
    expect(p1.input().lane).toBe(1);
    // A small step (0.6 shoulder widths ≈ 20 cm) works too…
    now = feed(p1, { shift: -0.6 }, now);
    expect(p1.input().lane).toBe(-1);
    // …while swaying on the spot does not.
    now = feed(p1, { shift: 0.15 }, now);
    expect(p1.input().lane).toBe(0);
    feed(p1, { leanDeg: 8 }, now);
    expect(p1.input().lane).toBe(0);
  });

  it('error mode asks for a lean or a step, never "the whole body"', () => {
    const p1 = new PlayerTracker(0);
    let now = feed(p1, {}, 0, 70);
    p1.setExpected('LEAN_LEFT');
    now = feed(p1, {}, now, 4);
    expect(p1.diagnosis?.message).toBe('Наклонись или шагни влево');
    feed(p1, { leanDeg: -13 }, now, 4);
    expect(p1.diagnosis?.ruleId).toBe('LEAN_INSUFFICIENT');
    expect(p1.diagnosis?.message).toBe('Ещё чуть левее — наклонись сильнее');
  });

  it('lanes are measured from where each player stands', () => {
    // Player 2 off-centre in the right half: neutral is still the middle lane.
    const p2 = new PlayerTracker(1);
    const now = feed(p2, { cx: 1.05 }, 0, 70);
    expect(p2.baseline).not.toBeNull();
    expect(p2.input().lane).toBe(0);
    feed(p2, { cx: 1.05, leanDeg: -25 }, now);
    expect(p2.input().lane).toBe(-1);
  });

  it('sends a player at the edge or at the middle line into their zone first', () => {
    // Player 1 at the left edge of the picture: no room to go left.
    const p1 = new PlayerTracker(0);
    feed(p1, { cx: 0.08 }, 0, 70);
    expect(p1.placement).toBe('move-right');
    expect(p1.baseline).toBeNull();
    expect(p1.setupStatus).toBe('Сдвинься правее');
    expect(p1.standZone?.ok).toBe(false);

    // Player 1 right at the middle line: no room to go right.
    const p1b = new PlayerTracker(0);
    feed(p1b, { cx: ASPECT / 2 - 0.05 }, 0, 70);
    expect(p1b.setupStatus).toBe('Сдвинься левее');

    // Player 2 right at the middle line.
    const p2 = new PlayerTracker(1);
    feed(p2, { cx: ASPECT / 2 + 0.05 }, 0, 70);
    expect(p2.setupStatus).toBe('Сдвинься правее');
    expect(p2.baseline).toBeNull();
  });

  it('asks the players to step back when half a picture is too narrow for them', () => {
    const p1 = new PlayerTracker(0);
    // Shoulders a third of the frame height wide: half the picture is only two shoulder widths.
    feed(p1, { cx: 0.33, sw: 0.33 }, 0, 70);
    expect(p1.placement).toBe('step-back');
    expect(p1.setupStatus).toBe('Отойди на шаг назад');
    expect(p1.standZone).toBeNull();
    expect(p1.baseline).toBeNull();
  });

  it('calibrates again when the picture changes shape (camera switched to wide)', () => {
    const p1 = new PlayerTracker(0);
    let now = feed(p1, {}, 0, 70);
    expect(p1.baseline).not.toBeNull();
    // The same player seen in a 16:9 picture: positions moved, the old spot is meaningless.
    now = feed(p1, { cx: 0.52 }, now, 1, 16 / 9);
    expect(p1.baseline).toBeNull();
    feed(p1, { cx: 0.52 }, now, 70, 16 / 9);
    expect(p1.baseline).not.toBeNull();
    expect(p1.input().lane).toBe(0);
  });
});
