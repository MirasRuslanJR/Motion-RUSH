import { describe, expect, it } from 'vitest';
import { createPose, LM, type Pose } from '../tracking/landmarks';
import {
  angleDiff,
  armAngles,
  BEAT_MS,
  bodyScore,
  danceAccuracy,
  DanceBodyTracker,
  DanceEngine,
  danceHint,
  DANCE_CONFIG,
  DANCE_POSES,
  poseMatch,
  type BodyOffset,
  type DanceInput,
  type DancePose,
} from './dance';
import { scriptedChoreography, sectionAt, SONG_BEATS, SONG_SECTIONS } from './choreography';
import type { Difficulty } from '../modes/difficulty';

const LEVELS: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

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

/** Only the shoulders, centred at (x, y), shoulder width `sw`. */
function shouldersAt(x: number, y: number, sw = 0.2): Pose {
  const pose = createPose();
  const ls = pose[LM.LEFT_SHOULDER];
  const rs = pose[LM.RIGHT_SHOULDER];
  if (ls && rs) {
    Object.assign(ls, { x: x - sw / 2, y, v: 1 });
    Object.assign(rs, { x: x + sw / 2, y, v: 1 });
  }
  return pose;
}

/** The body a dancer who does every move right has. */
function bodyFor(pose: DancePose): BodyOffset {
  switch (pose.body) {
    case 'squat':
      return { x: 0, y: 0.45 };
    case 'jump':
      return { x: 0, y: -0.25 };
    case 'step-left':
      return { x: -0.6, y: 0 };
    case 'step-right':
      return { x: 0.6, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

const byId = (id: string) => DANCE_POSES.find((p) => p.id === id) as DancePose;
const still: BodyOffset = { x: 0, y: 0 };

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

  it('a whole-body move needs the body: arms alone are only half of it', () => {
    const jump = byId('JUMP_V');
    const arms = armAngles(poseWithArms(160, 160));
    expect(poseMatch({ ...arms, body: still }, jump)).toBeCloseTo(0.5);
    expect(poseMatch({ ...arms, body: { x: 0, y: -0.25 } }, jump)).toBe(1);
    // A squat is not a jump, and a step to the wrong side is not a step.
    expect(poseMatch({ ...arms, body: { x: 0, y: 0.4 } }, jump)).toBeCloseTo(0.5);
    const stepLeft = byId('STEP_L');
    const stepArms = armAngles(poseWithArms(stepLeft.left, stepLeft.right));
    expect(poseMatch({ ...stepArms, body: { x: 0.6, y: 0 } }, stepLeft)).toBeLessThan(DANCE_CONFIG.good);
    expect(poseMatch({ ...stepArms, body: { x: -0.6, y: 0 } }, stepLeft)).toBe(1);
    expect(bodyScore('squat', null)).toBe(0);
  });

  it('measures squats, jumps and steps against where the dancer stands', () => {
    const t = new DanceBodyTracker();
    expect(t.update(shouldersAt(0.6, 0.4), 16, false)).toEqual({ x: 0, y: 0 });
    const squat = t.update(shouldersAt(0.6, 0.48), 16, true);
    expect(squat?.y).toBeCloseTo(0.4);
    expect(bodyScore('squat', squat)).toBe(1);
    expect(bodyScore('jump', t.update(shouldersAt(0.6, 0.35), 16, true))).toBe(1);
    const step = t.update(shouldersAt(0.48, 0.4), 16, true);
    expect(step?.x).toBeCloseTo(-0.6);
    expect(bodyScore('step-left', step)).toBe(1);
    expect(bodyScore('step-right', step)).toBe(0);
    // Between body moves the spot follows a dancer who wandered off...
    for (let i = 0; i < 600; i++) t.update(shouldersAt(0.48, 0.4), 16, false);
    expect(Math.abs(t.update(shouldersAt(0.48, 0.4), 16, true)?.x ?? 1)).toBeLessThan(0.05);
    // ...but a squat held between moves does not drag it down.
    for (let i = 0; i < 600; i++) t.update(shouldersAt(0.48, 0.48), 16, false);
    expect(t.update(shouldersAt(0.48, 0.48), 16, true)?.y).toBeCloseTo(0.4, 1);
    expect(t.update(null, 16, false)).toBeNull();
  });

  it('tells which arm to move and which way', () => {
    const v = byId('V');
    expect(danceHint(armAngles(poseWithArms(90, 155)), v)).toBe('Левую руку выше');
    expect(danceHint(armAngles(poseWithArms(155, 90)), v)).toBe('Правую руку выше');
    expect(danceHint(armAngles(poseWithArms(155, 155)), v)).toMatch(/^Точно/);
    expect(danceHint(armAngles(poseWithArms(170, 15)), byId('LOW_V'))).toBe('Левую руку ниже, правую руку выше');
    expect(danceHint(null, v)).toMatch(/кадр/);
  });

  it('tells what the body still has to do in a whole-body move', () => {
    const squat = byId('SQUAT_T');
    const t = armAngles(poseWithArms(90, 90));
    expect(danceHint({ ...t, body: still }, squat)).toBe('Присядь на бит');
    expect(danceHint({ ...t, body: { x: 0, y: 0.2 } }, squat)).toBe('Присядь глубже');
    expect(danceHint({ ...t, body: { x: 0, y: 0.4 } }, squat)).toMatch(/^Точно/);
    expect(danceHint({ ...armAngles(poseWithArms(90, 15)), body: still }, squat)).toBe('Присядь на бит, правую руку выше');
    expect(danceHint({ ...armAngles(poseWithArms(165, 20)), body: { x: -0.1, y: 0 } }, byId('STEP_L'))).toBe('Шагни влево');
    expect(danceHint({ ...armAngles(poseWithArms(20, 165)), body: { x: 0.3, y: 0 } }, byId('STEP_R'))).toBe('Шагни ещё правее');
    expect(danceHint({ ...armAngles(poseWithArms(160, 160)), body: still }, byId('JUMP_V'))).toBe('Подпрыгни на бит');
    expect(danceHint({ ...armAngles(poseWithArms(0, 0)), body: still }, byId('JUMP_V'))).toBe('Подпрыгни на бит и руки как на карточке');
  });

  it('dances a written choreography: the same moves every time, on the beat, inside the song', () => {
    for (const level of LEVELS) {
      const a = scriptedChoreography(level);
      expect(a).toEqual(scriptedChoreography(level));
      for (let i = 0; i < a.length; i++) {
        const m = a[i];
        expect(m?.id).toBe(i);
        expect(m?.at).toBe((m?.beat ?? 0) * BEAT_MS);
        expect(m?.beat ?? 0).toBeLessThan(SONG_BEATS);
        // After the 4-3-2-1 count.
        expect(m?.beat ?? 0).toBeGreaterThanOrEqual(8);
        if (i > 0) expect((m?.beat ?? 0) - (a[i - 1]?.beat ?? 0)).toBeGreaterThanOrEqual(level === 'easy' ? 2 : 1);
      }
    }
  });

  it('follows the song: arms in the verse, a squat before the drop and a jump right on it', () => {
    for (const level of LEVELS) {
      const a = scriptedChoreography(level);
      for (const m of a.filter((x) => sectionAt(x.beat).kind === 'verse' && sectionAt(x.beat).from === 16)) expect(m.pose.body).toBeUndefined();
      for (const drop of SONG_SECTIONS.filter((s) => s.kind === 'drop')) {
        const onDrop = a.find((m) => m.beat === drop.from);
        expect(onDrop?.pose.body).toBe('jump');
        const before = a.filter((m) => m.beat < drop.from).at(-1);
        expect(before?.pose.body).toBe('squat');
      }
      expect(a.at(-1)?.pose.id).toBe('V');
    }
  });

  it('harder levels dance more moves, all of them use the whole body, and steps go left and right in turn', () => {
    const counts = LEVELS.map((l) => scriptedChoreography(l).length);
    for (let i = 1; i < counts.length; i++) expect(counts[i] ?? 0).toBeGreaterThan(counts[i - 1] ?? 0);
    for (const level of LEVELS) {
      const a = scriptedChoreography(level);
      const body = a.filter((m) => m.pose.body);
      expect(body.length / a.length).toBeGreaterThan(0.3);
      expect(new Set(body.map((m) => m.pose.body))).toEqual(new Set(['squat', 'jump', 'step-left', 'step-right']));
      const steps = body.filter((m) => m.pose.body?.startsWith('step')).map((m) => m.pose.body);
      for (let i = 1; i < steps.length; i++) expect(steps[i]).not.toBe(steps[i - 1]);
    }
  });

  it('a wider tolerance on easier levels forgives a sloppier pose', () => {
    const t = byId('T');
    const sloppy = armAngles(poseWithArms(90 + 38, 90 - 38));
    expect(poseMatch(sloppy, t, 1.3)).toBeGreaterThan(poseMatch(sloppy, t));
    expect(poseMatch(sloppy, t, 0.78)).toBeLessThan(poseMatch(sloppy, t));
  });
  it('judges two dancers independently: exact moves are PERFECT, standing still is a MISS', () => {
    const moves = scriptedChoreography('expert');
    const dance = new DanceEngine(moves, 2);
    for (let t = 0; t <= dance.duration; t += 16) {
      const move = dance.current;
      const perfect: DanceInput | null = move ? { ...armAngles(poseWithArms(move.pose.left, move.pose.right)), body: bodyFor(move.pose) } : null;
      dance.update(t, [perfect, { ...armAngles(poseWithArms(0, 0)), body: still }]);
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
    const moves = scriptedChoreography('normal').slice(0, 1);
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
