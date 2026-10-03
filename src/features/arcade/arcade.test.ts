import { describe, expect, it } from 'vitest';
import type { Point } from '../../lib/math/geometry';
import type { GestureEvent, GestureType } from '../gestures/types';
import { LM, type Pose } from '../tracking/landmarks';
import { buildSyntheticPose } from '../tracking/syntheticPose';
import { FREEZE, FreezeGame, motionEnergy } from './freeze';
import { REACTION, ReactionGame } from './reaction';
import { SQUATS, SquatGame } from './squats';
import { distToSegment, STARS, StarCatch, type Star } from './starCatch';
import type { ArcadeInput } from './types';

const ASPECT = 4 / 3;
const SW = 0.2;
const CENTER = { x: 0.67, y: 0.42 };

function standing(): Pose {
  return buildSyntheticPose({ cx: CENTER.x, cy: CENTER.y, sw: SW });
}

/** A standing pose with the hands moved to the given points (null = hand not visible). */
function withHands(left: Point | null, right: Point | null): Pose {
  const pose = standing();
  const put = (i: number, p: Point | null) => {
    const l = pose[i];
    if (!l) return;
    if (p) {
      l.x = p.x;
      l.y = p.y;
      l.v = 0.99;
    } else {
      l.v = 0;
    }
  };
  put(LM.LEFT_WRIST, left);
  put(LM.LEFT_INDEX, left);
  put(LM.RIGHT_WRIST, right);
  put(LM.RIGHT_INDEX, right);
  return pose;
}

function input(pose: Pose | null, extra: Partial<ArcadeInput> = {}): ArcadeInput {
  return { pose, baseline: null, aspect: ASPECT, inferred: true, events: [], lateral: null, vertical: null, hint: null, ...extra };
}

function star(game: StarCatch, x: number, y: number, bomb = false): Star {
  const s: Star = { id: 999, x, y, r: STARS.radiusSW * SW, hitR: (STARS.radiusSW + STARS.handSW) * SW, bornAt: game.time, ttl: 2000, bomb, closest: Infinity };
  game.stars.push(s);
  return s;
}

function gesture(type: GestureType, phase: 'start' | 'end', timestamp: number): GestureEvent {
  return { type, phase, confidence: 1, timestamp, features: { leanX: 0, crouchDepth: 0, leftHandLift: 0, rightHandLift: 0 }, source: 'pose-rules' };
}

describe('Star Catch', () => {
  it('lights stars within arm’s reach and inside the picture', () => {
    const game = new StarCatch(7);
    const hidden = withHands(null, null);
    for (let i = 0; i < 200; i++) game.update(input(hidden), 50);
    expect(game.stars.length).toBeGreaterThan(0);
    for (const s of game.stars) {
      const d = Math.hypot(s.x - CENTER.x, s.y - CENTER.y) / SW;
      expect(d).toBeGreaterThan(0.9);
      expect(d).toBeLessThan(STARS.reachSW[1] + 0.1);
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(ASPECT);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(1);
    }
  });

  it('a touch catches a star — and so does a fast swipe across it', () => {
    const game = new StarCatch(1);
    game.update(input(withHands(null, null)), 16);
    const a = star(game, 0.4, 0.2);
    const sounds = game.update(input(withHands({ x: 0.4, y: 0.2 }, null)), 16);
    expect(game.stars).not.toContain(a);
    expect(game.caught).toBe(1);
    expect(game.score).toBeGreaterThan(0);
    expect(sounds.some((s) => s === 'orb' || s === 'perfect')).toBe(true);

    // The hand jumps from one side of the star to the other between two frames.
    const b = star(game, 0.95, 0.2);
    game.update(input(withHands(null, { x: 0.75, y: 0.2 })), 16);
    expect(game.stars).toContain(b);
    game.update(input(withHands(null, { x: 1.15, y: 0.2 })), 16);
    expect(game.stars).not.toContain(b);
    expect(game.caught).toBe(2);
    expect(distToSegment({ x: 0.95, y: 0.2 }, { x: 0.75, y: 0.2 }, { x: 1.15, y: 0.2 })).toBe(0);
  });

  it('a bomb costs a life and breaks the series', () => {
    const game = new StarCatch(2);
    game.update(input(withHands(null, null)), 16);
    game.combo = 4;
    star(game, 0.4, 0.2, true);
    game.update(input(withHands({ x: 0.4, y: 0.2 }, null)), 16);
    expect(game.lives).toBe(STARS.lives - 1);
    expect(game.combo).toBe(0);
    expect(game.hud().toast?.text).toContain('Бомба');
  });

  it('a star a hand almost reached tells the player to reach further', () => {
    const game = new StarCatch(3);
    game.update(input(withHands(null, null)), 16);
    const s = star(game, 0.4, 0.2);
    s.ttl = 100;
    // Just outside the touch distance.
    game.update(input(withHands({ x: 0.4 + s.hitR * 1.3, y: 0.2 }, null)), 16);
    game.update(input(withHands({ x: 0.4 + s.hitR * 1.3, y: 0.2 }, null)), 120);
    expect(game.missed).toBe(1);
    expect(game.hud().toast?.text).toContain('Почти');
  });

  it('the round ends after a minute', () => {
    const game = new StarCatch(4);
    const pose = withHands(null, null);
    let sounds: string[] = [];
    for (let t = 0; t <= STARS.durationMs && !game.done; t += 100) sounds = game.update(input(pose), 100);
    expect(game.done).toBe(true);
    expect(sounds).toContain('complete');
    expect(game.result().lines.length).toBeGreaterThan(2);
  });
});

/** Running on the spot: knees and arms swing up and down every frame. */
function running(step: number): Pose {
  const pose = standing();
  const lift = step % 2 === 0 ? 0.08 : -0.02;
  for (const i of [LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_WRIST]) {
    const l = pose[i];
    if (l) l.y -= lift;
  }
  for (const i of [LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.LEFT_WRIST]) {
    const l = pose[i];
    if (l) l.y += lift;
  }
  return pose;
}

/** Waving: only the arms move. */
function waving(step: number): Pose {
  const pose = standing();
  const d = step % 2 === 0 ? 0.08 : -0.08;
  for (const i of [LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ELBOW, LM.RIGHT_ELBOW]) {
    const l = pose[i];
    if (l) l.x += d;
  }
  return pose;
}

describe('Freeze!', () => {
  it('measures how fast each body part moves', () => {
    const still = standing();
    expect(motionEnergy(still, standing(), 100, SW).total).toBe(0);
    const e = motionEnergy(running(0), running(1), 100, SW);
    expect(e.legs).toBeGreaterThan(2);
    expect(e.torso).toBe(0);
  });

  it('running on green covers ground; standing still on red survives; moving on red gets caught', () => {
    const game = new FreezeGame(5);
    let step = 0;
    const tick = (pose: Pose) => game.update(input(pose), 50);
    // Ready → green.
    while (game.light !== 'green') tick(standing());
    while (game.light === 'green') tick(running(step++));
    expect(game.distance).toBeGreaterThan(5);
    const before = game.distance;

    // A red light: standing still.
    while (game.light === 'red') tick(standing());
    expect(game.redsSurvived).toBe(1);
    expect(game.lives).toBe(FREEZE.lives);

    // Next red: waving the arms.
    while (game.light !== 'red') tick(standing());
    while (game.light === 'red' && game.caught === 0) tick(waving(step++));
    expect(game.caught).toBe(1);
    expect(game.lives).toBe(FREEZE.lives - 1);
    expect(game.distance).toBeLessThan(before);
    expect(game.lastCatch?.group).toBe('arms');
    expect(game.hud().toast?.text).toContain('руки');
  });

  it('reaching 100 m finishes the race', () => {
    const game = new FreezeGame(6);
    game.distance = FREEZE.finishM - 0.5;
    let step = 0;
    while (game.light !== 'green') game.update(input(standing()), 50);
    for (let i = 0; i < 200 && !game.done; i++) game.update(input(running(step++)), 50);
    expect(game.finished).toBe(true);
    expect(game.result().headline).toMatch(/\d:\d\d/);
  });
});

describe('Reaction', () => {
  const title = (m: GestureType) => m;

  it('measures from the signal to the recognised move; moving early is a false start', () => {
    const game = new ReactionGame(title, 8);
    const pose = standing();
    let now = 0;
    // Read through a function: the phase changes inside update(), behind TypeScript's back.
    const phase = () => game.phase;
    const tick = (events: GestureEvent[] = [], extra: Partial<ArcadeInput> = {}) => {
      now += 50;
      return game.update(input(pose, { events, ...extra }), 50, now);
    };
    while (phase() !== 'wait') tick();
    tick([gesture('JUMP', 'start', now)]);
    expect(game.falseStarts).toBe(1);
    expect(phase()).toBe('ready');

    while (phase() !== 'cue') tick();
    const cueAt = now;
    const cue = game.cue ?? 'JUMP';
    const other: GestureType = cue === 'JUMP' ? 'CROUCH' : 'JUMP';
    tick([gesture(other, 'start', cueAt + 200)]);
    expect(game.wrong).toBe(1);
    tick([gesture(cue, 'start', cueAt + 350)]);
    expect(phase()).toBe('shown');
    expect(game.times[0]).toEqual({ move: cue, ms: 350 });
    expect(game.hud().cue?.text).toBe('350 мс');
  });

  it('no move in time is a missed round; ten rounds end the game', () => {
    const game = new ReactionGame(title, 9);
    const pose = standing();
    let now = 0;
    while (!game.done && now < 200000) {
      now += 50;
      game.update(input(pose), 50, now);
    }
    expect(game.done).toBe(true);
    expect(game.times).toHaveLength(REACTION.rounds);
    expect(game.times.every((r) => r.ms === null)).toBe(true);
    expect(game.result().headline).toBe(`${REACTION.timeoutMs} мс`);
  });
});

describe('Squat 30', () => {
  it('counts full squats and passes on technique hints', () => {
    const game = new SquatGame();
    expect(game.expected).toBe('CROUCH');
    const pose = standing();
    game.update(input(pose, { events: [gesture('CROUCH', 'start', 0)] }), 100);
    expect(game.count).toBe(0);
    game.update(input(pose, { events: [gesture('CROUCH', 'end', 100)] }), 100);
    expect(game.count).toBe(1);
    game.update(input(pose, { hint: 'Присядь глубже — таз ниже' }), 100);
    expect(game.hud().toast?.text).toBe('Присядь глубже — таз ниже');
    for (let t = 0; t < SQUATS.durationMs && !game.done; t += 500) game.update(input(pose), 500);
    expect(game.done).toBe(true);
    expect(game.result().headline).toBe('1');
  });
});
