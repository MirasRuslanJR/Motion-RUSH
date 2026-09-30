import { describe, expect, it } from 'vitest';
import { createPose, LM, type Pose } from '../tracking/landmarks';
import {
  angleDiff,
  armAngles,
  BEAT_MS,
  danceAccuracy,
  DanceEngine,
  danceHint,
  DANCE_CONFIG,
  DANCE_POSES,
  generateChoreography,
  poseMatch,
  type ArmAngles,
  type DancePose,
} from './dance';

/** Mirrored-frame pose with both arms pointing at the given angles (0 down, 90 out, 180 up). */
function poseWithArms(left: number, right: number): Pose {
  const pose = createPose();
  for (const p of pose) p.v = 1;
  const put = (i: number, x: number, y: number) => {
    const p = pose[i];
    if (p) {
      p.x = x;
      p.y = y;
    }
  };
  const ls = { x: 0.55, y: 0.4 };
  const rs = { x: 0.75, y: 0.4 };
  const arm = (s: { x: number; y: number }, deg: number, out: -1 | 1, e: number, w: number) => {
    const r = (deg * Math.PI) / 180;
    put(e, s.x + out * Math.sin(r) * 0.14, s.y + Math.cos(r) * 0.14);
    put(w, s.x + out * Math.sin(r) * 0.28, s.y + Math.cos(r) * 0.28);
  };
  put(LM.LEFT_SHOULDER, ls.x, ls.y);
  put(LM.RIGHT_SHOULDER, rs.x, rs.y);
  arm(ls, left, -1, LM.LEFT_ELBOW, LM.LEFT_WRIST);
  arm(rs, right, 1, LM.RIGHT_ELBOW, LM.RIGHT_WRIST);
  return pose;
}

const byId = (id: string) => DANCE_POSES.find((p) => p.id === id) as DancePose;

describe('dance floor', () => {
  it('reads arm directions from the skeleton', () => {
    const a = armAngles(poseWithArms(90, 170));
    expect(a.visible).toBe(true);
    expect(angleDiff(a.left, 90)).toBeLessThan(1);
    expect(angleDiff(a.right, 170)).toBeLessThan(1);
    expect(angleDiff(179, -179)).toBeCloseTo(2);
  });

  it('scores an exact pose 1 and a wrong one 0', () => {
    const t = byId('T');
    expect(poseMatch(armAngles(poseWithArms(90, 90)), t)).toBe(1);
    expect(poseMatch(armAngles(poseWithArms(0, 0)), t)).toBe(0);
    expect(poseMatch(armAngles(poseWithArms(90, 0)), t)).toBeCloseTo(0.5);
  });

  it('tells which arm to move and which way', () => {
    const v = byId('V');
    expect(danceHint(armAngles(poseWithArms(90, 155)), v)).toBe('Левую руку выше');
    expect(danceHint(armAngles(poseWithArms(155, 90)), v)).toBe('Правую руку выше');
    expect(danceHint(armAngles(poseWithArms(155, 155)), v)).toMatch(/^Точно/);
    expect(danceHint(armAngles(poseWithArms(170, 15)), byId('LOW_V'))).toBe('Левую руку ниже, правую руку выше');
    expect(danceHint(null, v)).toMatch(/кадр/);
  });

  it('builds a random choreography on the beat, never repeating a pose twice in a row', () => {
    const a = generateChoreography(1);
    expect(a).toEqual(generateChoreography(1));
    expect(a).not.toEqual(generateChoreography(2));
    expect(a.length).toBeGreaterThan(40);
    for (let i = 1; i < a.length; i++) {
      expect(a[i]?.pose.id).not.toBe(a[i - 1]?.pose.id);
      expect(a[i]?.at).toBe((a[i]?.beat ?? 0) * BEAT_MS);
      expect((a[i]?.at ?? 0) - (a[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(2 * BEAT_MS);
    }
  });

  it('judges two dancers independently: exact poses are PERFECT, standing still is a MISS', () => {
    const moves = generateChoreography(7);
    const dance = new DanceEngine(moves, 2);
    for (let t = 0; t <= dance.duration; t += 16) {
      const move = dance.current;
      const perfect: ArmAngles | null = move ? armAngles(poseWithArms(move.pose.left, move.pose.right)) : null;
      dance.update(t, [perfect, armAngles(poseWithArms(0, 0))]);
    }
    const [p1, p2] = dance.dancers;
    expect(dance.finished).toBe(true);
    expect(p1?.perfect).toBe(moves.length);
    expect(p1?.bestCombo).toBe(moves.length);
    expect(p1 && danceAccuracy(p1)).toBe(1);
    // Arms down happens to match "low" poses partially at best — never a full run.
    expect(p2 && danceAccuracy(p2)).toBeLessThan(0.3);
    expect((p1?.score ?? 0) > (p2?.score ?? 0)).toBe(true);
  });

  it('only a pose held around the beat counts', () => {
    const moves = generateChoreography(3).slice(0, 1);
    const move = moves[0];
    if (!move) throw new Error('no move');
    const dance = new DanceEngine(moves, 1);
    const right = armAngles(poseWithArms(move.pose.left, move.pose.right));
    // Correct pose, but a full second too early — then arms down on the beat.
    dance.update(move.at - 1000, [right]);
    dance.update(move.at, [armAngles(poseWithArms(0, 0))]);
    dance.update(move.at + DANCE_CONFIG.lateMs + 1, [null]);
    expect(dance.dancers[0]?.miss).toBe(1);
  });
});
