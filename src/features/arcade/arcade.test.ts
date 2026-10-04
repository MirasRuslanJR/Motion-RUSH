import { describe, expect, it } from 'vitest';
import type { Point } from '../../lib/math/geometry';
import type { GestureEvent, GestureType } from '../gestures/types';
import { LM, type Pose } from '../tracking/landmarks';
import { buildSyntheticPose } from '../tracking/syntheticPose';
import { BOSS, BossFight } from './boss';
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

/** Standing still with the arms at the given angles (0 down, 90 out, 180 up), as the dance floor measures them. */
function figurePose(left: number, right: number): Pose {
  const pose = standing();
  const arm = (shoulder: number, elbow: number, wrist: number, deg: number, out: -1 | 1) => {
    const s = pose[shoulder];
    if (!s) return;
    const r = (deg * Math.PI) / 180;
    for (const [i, k] of [
      [elbow, 0.7],
      [wrist, 1.45],
    ] as const) {
      const p = pose[i];
      if (p) {
        p.x = s.x + out * Math.sin(r) * SW * k;
        p.y = s.y + Math.cos(r) * SW * k;
        p.v = 0.99;
      }
    }
  };
  arm(LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, left, -1);
  arm(LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST, right, 1);
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
    // Yellow warns; the first red is a plain freeze, no figure called.
    expect(game.light).toBe('yellow');
    expect(game.figure).toBeNull();
    while (game.light !== 'red') tick(standing());
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

  /** Plays standing still until a red light that calls a figure; returns that figure. */
  function toFigureRed(game: FreezeGame) {
    for (let i = 0; i < 5000 && !(game.light === 'red' && game.figure); i++) game.update(input(standing()), 50);
    if (!game.figure) throw new Error('no figure called');
    return game.figure;
  }

  it('calls a figure after the first red; holding it is a statue — a jump forward and points', () => {
    const game = new FreezeGame(11);
    const figure = toFigureRed(game);
    const before = game.distance;
    expect(game.hud().figure?.name).toBe(figure.name);
    while (game.light === 'red') game.update(input(figurePose(figure.pose.left, figure.pose.right)), 50);
    expect(game.statues).toBe(1);
    expect(game.bonus).toBe(FREEZE.statuePoints);
    expect(game.distance).toBeCloseTo(before + FREEZE.statueBonusM);
    expect(game.hud().toast?.text).toContain(figure.name);
    expect(game.result().lines[0]).toContain('1 из 1');
  });

  it('a wrong figure held still survives, but is no statue', () => {
    const game = new FreezeGame(11);
    toFigureRed(game);
    while (game.light === 'red') game.update(input(standing()), 50);
    expect(game.redsSurvived).toBe(2);
    expect(game.statues).toBe(0);
    expect(game.hud().toast?.text).toContain('фигура не та');
  });

  it('some yellows are a trick and go back to green', () => {
    const game = new FreezeGame(3);
    let tricks = 0;
    let prev = game.light;
    for (let i = 0; i < 4000; i++) {
      game.update(input(standing()), 50);
      if (prev === 'yellow' && game.light === 'green') tricks++;
      prev = game.light;
    }
    expect(tricks).toBeGreaterThan(0);
    expect(game.caught).toBe(0);
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

/** A player who does what the boss's attack needs: out of the struck lanes, down under a beam, up over a wave, both arms up when it is stunned. */
function bossDodger() {
  const jumped = new Set<number>();
  return (game: BossFight): ArcadeInput => {
    const t = game.time;
    const down = figurePose(0, 0);
    if (game.phase === 'stunned') return input(figurePose(155, 155));
    const a = game.attack;
    if (!a || a.result !== 'pending') return input(down);
    if (a.kind === 'beam') return input(down, { vertical: t >= a.hitAt - 200 ? 'CROUCH' : null });
    if (a.kind === 'wave') {
      const go = t >= a.hitAt - 120 && !jumped.has(a.id);
      if (go) jumped.add(a.id);
      return input(down, { events: go ? [gesture('JUMP', 'start', t)] : [], vertical: jumped.has(a.id) ? 'JUMP' : null });
    }
    const free = ([-1, 0, 1] as const).find((l) => !a.lanes.includes(l)) ?? 0;
    return input(down, { lateral: free === -1 ? 'LEAN_LEFT' : free === 1 ? 'LEAN_RIGHT' : null });
  };
}

function fight(game: BossFight, player: (g: BossFight) => ArcadeInput, maxMs = 300_000): void {
  for (let t = 0; t < maxMs && !game.done; t += 16) game.update(player(game), 16);
}

describe('Boss fight', () => {
  it('a player who dodges everything stuns the boss every three dodges, hits it with both arms up and wins', () => {
    const game = new BossFight(5);
    fight(game, bossDodger());
    expect(game.phase).toBe('won');
    expect(game.hp).toBe(0);
    expect(game.counters).toBe(BOSS.hp);
    expect(game.lives).toBe(BOSS.lives);
    expect(game.dodges).toBe(game.attacks);
    expect(game.attacks).toBe(BOSS.hp * BOSS.streakForStun);
    expect(game.result().caption).toBe('босс повержен');
  });

  it('every kind of attack comes once first', () => {
    const game = new BossFight(3);
    const kinds = new Map<number, string>();
    const dodge = bossDodger();
    for (let t = 0; t < 60_000 && kinds.size < 4; t += 16) {
      game.update(dodge(game), 16);
      if (game.attack) kinds.set(game.attack.id, game.attack.kind);
    }
    expect([...kinds.values()].sort()).toEqual(['beam', 'lane', 'sweep', 'wave']);
  });

  it('standing still gets hit — each hit says why — until the lives run out', () => {
    const game = new BossFight(11);
    fight(game, () => input(figurePose(0, 0)));
    expect(game.phase).toBe('lost');
    expect(game.lives).toBe(0);
    expect(game.hp).toBe(BOSS.hp);
    expect(game.hud().toast?.tone).toBe('bad');
    expect(game.result().caption).toMatch(/жизни кончились/);
  });

  it('a stunned boss needs both arms up — arms down lets it recover, and a jump’s swing does not count by itself', () => {
    const game = new BossFight(2);
    const dodge = bossDodger();
    for (let t = 0; t < 60_000 && game.phase !== 'stunned'; t += 16) game.update(dodge(game), 16);
    expect(game.phase).toBe('stunned');
    // Arms already up the moment it is stunned: too early to count.
    game.update(input(figurePose(155, 155)), 16);
    expect(game.hp).toBe(BOSS.hp);
    for (let i = 0; i < Math.ceil(BOSS.stunMs / 16) + 2; i++) game.update(input(figurePose(0, 0)), 16);
    expect(game.phase).toBe('fight');
    expect(game.hp).toBe(BOSS.hp);
    expect(game.hud().toast?.text).toMatch(/Не успел/);
  });

  it('asks for the move that saves the player: crouch, jump, or out of the struck lane', () => {
    const game = new BossFight(4);
    const seen = new Map<string, string | null>();
    const dodge = bossDodger();
    for (let t = 0; t < 60_000 && seen.size < 4; t += 16) {
      const a = game.attack;
      if (a && a.result === 'pending' && !seen.has(a.kind)) {
        // Standing in the centre lane, before moving.
        game.update(input(figurePose(0, 0)), 16);
        seen.set(a.kind, game.expected);
      }
      game.update(dodge(game), 16);
    }
    expect(seen.get('beam')).toBe('CROUCH');
    expect(seen.get('wave')).toBe('JUMP');
    expect(['LEAN_LEFT', 'LEAN_RIGHT', null]).toContain(seen.get('lane'));
    expect(['LEAN_LEFT', 'LEAN_RIGHT']).toContain(seen.get('sweep'));
  });

  it('difficulty: Expert warns later and has a life less, Easy a life more', () => {
    const expert = new BossFight(1, { pace: 1.3, lives: -1, score: 1.5 });
    const easy = new BossFight(1, { pace: 0.8, lives: 1, score: 0.8 });
    expect(expert.lives).toBe(BOSS.lives - 1);
    expect(easy.lives).toBe(BOSS.lives + 1);
    const warn = (g: BossFight) => {
      for (let t = 0; t < 10_000 && !g.attack; t += 16) g.update(input(figurePose(0, 0)), 16);
      return (g.attack?.hitAt ?? 0) - (g.attack?.startAt ?? 0);
    };
    expect(warn(expert)).toBeLessThan(warn(easy));
  });
});
