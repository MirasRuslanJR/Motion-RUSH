import { describe, expect, it } from 'vitest';
import { COURSES, GAME_CONFIG } from '../../config/game.config';
import type { ExpectedMotion } from '../gestures/types';
import { computeSessionStats } from '../results/sessionStats';
import { getMode, courseForMode, rulesForMode, timingForRecognition } from '../modes/modes';
import { dailySeed, generateCourse } from './course';
import { GameEngine, type GameEvent, type PlayerInput } from './GameEngine';
import { isPickup, POWER_UPS, type CourseItem, type Lane } from './types';

const DT = 16;
const idle: PlayerInput = {
  trackable: true,
  lane: 0,
  jumpHeld: false,
  crouchHeld: false,
  diagnosis: null,
  hint: null,
};

/** Jump this long before a barrier arrives (inside the airtime, early enough for PERFECT). */
const JUMP_LEAD_MS = 450;

/** Input that performs exactly what the game currently expects — jumps are timed, not held. */
function perfectInput(expected: ExpectedMotion | null, g: GameEngine): PlayerInput {
  const lane: Lane = expected === 'LEAN_LEFT' ? -1 : expected === 'LEAN_RIGHT' ? 1 : 0;
  const item = g.activeItem;
  const jumpHeld = expected === 'JUMP' && item !== null && item.arriveAt - g.time <= JUMP_LEAD_MS;
  return { ...idle, lane, jumpHeld, crouchHeld: expected === 'CROUCH' };
}

function play(game: GameEngine, input: (g: GameEngine) => PlayerInput, maxMs = 200_000): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < maxMs && game.phase !== 'ended'; t += DT) events.push(...game.update(DT, input(game)));
  return events;
}

describe('course generation', () => {
  it('is deterministic for a seed', () => {
    expect(generateCourse(42)).toEqual(generateCourse(42));
    expect(generateCourse(42)).not.toEqual(generateCourse(43));
  });

  it('introduces every move first, then mixes, with sane spacing', () => {
    const course = generateCourse();
    const required = course.filter((c) => !isPickup(c.kind));
    // Every move is introduced first — in a seed-dependent order.
    expect(required.slice(0, 4).map((c) => c.kind).sort()).toEqual([...GAME_CONFIG.course.intro].sort());
    expect(required.length).toBeGreaterThan(25);
    for (let i = 1; i < required.length; i++) {
      const gap = (required[i]?.arriveAt ?? 0) - (required[i - 1]?.arriveAt ?? 0);
      expect(gap).toBeGreaterThanOrEqual(1400);
    }
    for (let i = 2; i < required.length; i++) {
      const same = required[i]?.kind === required[i - 1]?.kind && required[i]?.kind === required[i - 2]?.kind;
      expect(same).toBe(false);
    }
  });
});

describe('game engine', () => {
  it('counts down only while the player is visible', () => {
    const game = new GameEngine();
    game.update(1000, { ...idle, trackable: false });
    expect(game.countdownValue).toBeNull();
    const events = [...game.update(10, idle), ...game.update(GAME_CONFIG.countdownStepMs, idle)];
    expect(events).toEqual([
      { type: 'countdown', value: 3 },
      { type: 'countdown', value: 2 },
    ]);
  });

  it('a perfect player clears the whole course', () => {
    const game = new GameEngine();
    const events = play(game, (g) => perfectInput(g.expected, g));
    const result = game.result();
    expect(result.outcome).toBe('complete');
    expect(events.some((e) => e.type === 'miss')).toBe(false);
    expect(result.obstacles.every((o) => o.result !== 'miss')).toBe(true);
    expect(result.bestCombo).toBe(result.obstacles.length);
    expect(result.score).toBeGreaterThan(result.obstacles.length * 100);
    expect(game.energy).toBe(GAME_CONFIG.energy);
  });

  it('an idle player runs out of energy with concrete miss reasons', () => {
    const game = new GameEngine();
    const events = play(game, () => idle);
    const result = game.result();
    expect(result.outcome).toBe('out-of-energy');
    const misses = result.obstacles.filter((o) => o.result === 'miss');
    // A shield picked up in the middle lane absorbs one miss each; a heart gives a life back.
    const absorbed = events.filter((e) => e.type === 'shield-used').length;
    const healed = events.filter((e) => e.type === 'powerup' && e.kind === 'HEART' && !e.points).length;
    expect(misses.length - absorbed - healed).toBe(GAME_CONFIG.energy);
    expect(misses[0]?.missReason?.ruleId).toBe('NO_ATTEMPT');
    expect(misses[0]?.missReason?.message).toMatch(/^Движения не было — \S/);
  });

  it('pauses game time while tracking is lost and resumes after a stable return', () => {
    const game = new GameEngine();
    play(game, () => idle, 3000);
    expect(game.phase).toBe('running');
    const before = game.time;
    for (let i = 0; i < 60; i++) game.update(DT, { ...idle, trackable: false });
    expect(game.phase).toBe('paused');
    const frozen = game.time;
    expect(frozen - before).toBeLessThan(GAME_CONFIG.lostGraceMs + DT * 2);
    for (let i = 0; i < 20; i++) game.update(DT, { ...idle, trackable: false });
    expect(game.time).toBe(frozen);
    for (let t = 0; t <= GAME_CONFIG.resumeStableMs + GAME_CONFIG.resumeCountdownMs + 64; t += DT) game.update(DT, idle);
    expect(game.phase).toBe('running');
  });

  it('records the error hint shown before a miss and credits corrections', () => {
    const game = new GameEngine([
      { id: 0, kind: 'GATE_LEFT', arriveAt: 3000, leadMs: 2300, lane: -1 },
      { id: 1, kind: 'HURDLE', arriveAt: 5600, leadMs: 2300, lane: 0 },
    ]);
    const hint = { expected: 'LEAN_LEFT' as const, verdict: 'near' as const, ruleId: 'LEAN_INSUFFICIENT', message: 'Наклон недостаточный — сместись ещё левее' };
    // First gate: player tries, sees the hint, never gets there → miss with that reason.
    // Countdown (3 × 800 ms) + first arrival (3000 ms) + grace.
    play(game, (g) => (g.expected === 'LEAN_LEFT' ? { ...idle, hint, diagnosis: hint } : idle), 5900);
    const first = game.result().obstacles[0];
    expect(first?.result).toBe('miss');
    expect(first?.missReason?.ruleId).toBe('LEAN_INSUFFICIENT');

    // Second obstacle (hurdle): hint first, then the correct move → corrected.
    const jumpHint = { expected: 'JUMP' as const, verdict: 'near' as const, ruleId: 'JUMP_HANDS_LOW', message: 'Руки на уровне плеч' };
    let hinted = 0;
    play(
      game,
      (g) => {
        if (g.expected !== 'JUMP') return idle;
        hinted += DT;
        return hinted < 400 ? { ...idle, hint: jumpHint } : perfectInput('JUMP', g);
      },
      8000,
    );
    const second = game.result().obstacles[1];
    expect(second?.result).not.toBe('miss');
    expect(second?.corrected).toBe(true);
    expect(game.result().hintsShown).toBe(2);
  });

  it('jumping far too early is diagnosed as TOO_EARLY', () => {
    const game = new GameEngine();
    let jumpedAt: number | null = null;
    play(
      game,
      (g) => {
        if (g.expected !== 'JUMP' || !g.activeItem) return perfectInput(g.expected, g);
        jumpedAt ??= g.time;
        return { ...idle, jumpHeld: g.time - jumpedAt < 50 };
      },
      12000,
    );
    const hurdle = game.result().obstacles.find((o) => o.required === 'JUMP');
    expect(hurdle?.result).toBe('miss');
    expect(hurdle?.missReason?.ruleId).toBe('TOO_EARLY');
  });
});

describe('session stats', () => {
  it('computes real accuracy, strongest move and top mistakes', () => {
    const game = new GameEngine();
    // Never ducks, does everything else perfectly.
    play(game, (g) => (g.expected === 'CROUCH' ? idle : perfectInput(g.expected, g)));
    const stats = computeSessionStats(game.result());
    const crouch = stats.perMove.find((m) => m.motion === 'CROUCH');
    expect(crouch?.accuracy).toBe(0);
    expect(stats.needsWork?.motion).toBe('CROUCH');
    expect(stats.strongest?.accuracy).toBe(1);
    expect(stats.accuracy).toBeCloseTo(stats.cleared / stats.total);
    expect(stats.topMistakes[0]?.count).toBe(stats.misses);
    // The bot switches pose as soon as a new obstacle becomes active → it is in position well before arrival.
    expect(stats.avgLeadMs).toBeGreaterThan(GAME_CONFIG.perfectLeadMs);
    expect(stats.perfect).toBe(stats.cleared);
  });
});

describe('game modes and power-ups', () => {
  const item = (id: number, kind: CourseItem['kind'], arriveAt: number, lane: Lane = 0): CourseItem => ({ id, kind, arriveAt, leadMs: 2000, lane });

  it('a shield absorbs exactly one miss', () => {
    const game = new GameEngine([item(0, 'SHIELD', 1000), item(1, 'HURDLE', 3000), item(2, 'HURDLE', 5000)]);
    const events = play(game, () => idle);
    expect(events.filter((e) => e.type === 'powerup')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'shield-used')).toHaveLength(1);
    expect(game.result().obstacles.filter((o) => o.result === 'miss')).toHaveLength(2);
    expect(game.energy).toBe(GAME_CONFIG.energy - 1);
    expect(game.shield).toBe(false);
  });

  it('a boost doubles the points while it lasts', () => {
    const game = new GameEngine([item(0, 'BOOST', 1000), item(1, 'HURDLE', 3000)]);
    const events = play(game, (g) => perfectInput(g.expected, g));
    const clear = events.find((e) => e.type === 'clear');
    expect(clear?.type === 'clear' && clear.multiplier).toBe(GAME_CONFIG.powerUps.boostMultiplier);
  });

  it('a magnet pulls in energy orbs from every lane while it lasts', () => {
    const game = new GameEngine([
      item(0, 'MAGNET', 1000),
      item(1, 'ORB', 2000, -1),
      item(2, 'ORB', 3000, 1),
      item(3, 'ORB', 12000, -1),
      item(4, 'HURDLE', 13000),
    ]);
    const events = play(game, (g) => perfectInput(g.expected, g));
    expect(events.filter((e) => e.type === 'powerup' && e.kind === 'MAGNET')).toHaveLength(1);
    // The runner never leaves the middle lane: the side orbs come anyway — until the magnet runs out.
    expect(events.filter((e) => e.type === 'orb')).toHaveLength(2);
  });

  it('slow motion slows game time down for a while', () => {
    const game = new GameEngine([item(0, 'SLOWMO', 1000), item(1, 'HURDLE', 9000)]);
    play(game, () => idle, GAME_CONFIG.countdownStepMs * 3 + 1200);
    expect(game.slowed).toBe(true);
    const before = game.time;
    for (let i = 0; i < 10; i++) game.update(100, idle);
    expect(game.time - before).toBeCloseTo(1000 * GAME_CONFIG.powerUps.slowScale, 0);
    // …and normal speed comes back.
    play(game, () => idle, 10_000);
    expect(game.slowed).toBe(false);
    expect(game.timeScale).toBe(1);
  });

  it('a heart gives a life back, or points when energy is full', () => {
    const full = new GameEngine([item(0, 'HEART', 1000), item(1, 'HURDLE', 3000)]);
    const fullEvents = play(full, (g) => perfectInput(g.expected, g));
    const bonus = fullEvents.find((e) => e.type === 'powerup');
    expect(bonus?.type === 'powerup' && bonus.points).toBe(GAME_CONFIG.powerUps.heartPoints);
    expect(full.energy).toBe(GAME_CONFIG.energy);

    const hurt = new GameEngine([item(0, 'HURDLE', 1000), item(1, 'HEART', 3000), item(2, 'HURDLE', 6000)]);
    // Misses the first hurdle, picks up the heart, clears the last one.
    play(hurt, (g) => (g.activeItem?.id === 0 ? idle : perfectInput(g.expected, g)));
    expect(hurt.result().obstacles[0]?.result).toBe('miss');
    expect(hurt.energy).toBe(GAME_CONFIG.energy);
  });

  it('courses bring every kind of power-up', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) for (const c of generateCourse(seed)) kinds.add(c.kind);
    for (const kind of POWER_UPS) expect(kinds.has(kind)).toBe(true);
  });

  it('practice never costs energy and hardcore ends on the first miss', () => {
    const practice = getMode('practice');
    const soft = new GameEngine(courseForMode(practice), undefined, rulesForMode(practice, 'body'));
    play(soft, () => idle);
    expect(soft.result().outcome).toBe('complete');
    expect(soft.energy).toBe(practice.energy);

    const hardcore = getMode('hardcore');
    const hard = new GameEngine(courseForMode(hardcore), undefined, rulesForMode(hardcore, 'body'));
    const events = play(hard, () => idle);
    const result = hard.result();
    expect(result.outcome).toBe('out-of-energy');
    expect(result.mode).toBe('hardcore');
    expect(result.scheme).toBe('body');
    const absorbed = events.filter((e) => e.type === 'shield-used').length;
    expect(result.obstacles.filter((o) => o.result === 'miss').length - absorbed).toBe(1);
  });

  it('each mode builds its own course', () => {
    const duration = (id: string) => {
      const course = courseForMode(getMode(id));
      return course[course.length - 1]?.arriveAt ?? 0;
    };
    // A pickup may sit half a gap after the last obstacle.
    expect(duration('sprint')).toBeLessThan((COURSES.sprint.phases[0]?.untilMs ?? 0) + 1000);
    expect(duration('endless')).toBeGreaterThan(5 * 60_000);
    // A new course every run (random seed), the same course for everyone on a given day.
    expect(courseForMode(getMode('classic'))).not.toEqual(courseForMode(getMode('classic')));
    expect(courseForMode(getMode('daily'))).toEqual(courseForMode(getMode('daily')));
    expect(courseForMode(getMode('duel'), 7)).toEqual(courseForMode(getMode('duel'), 7));
    expect(courseForMode(getMode('duel'), 7)).not.toEqual(courseForMode(getMode('duel'), 8));
  });

  it('a jump is one take-off: holding the pose does not keep the runner in the air', () => {
    const game = new GameEngine([item(0, 'HURDLE', 4000)]);
    // Arms up / tiptoe held for the whole run, starting long before the barrier.
    const events = play(game, (g) => ({ ...idle, jumpHeld: g.phase === 'running' }));
    expect(events.filter((e) => e.type === 'jump')).toHaveLength(1);
    // Landed long before the barrier arrived.
    expect(game.result().obstacles[0]?.result).toBe('miss');
  });

  it('a new jump needs a landing first', () => {
    const game = new GameEngine([item(0, 'HURDLE', 6000)]);
    let t = 0;
    // Toggle the jump pose every 100 ms: only one take-off per airtime.
    play(game, (g) => {
      if (g.phase !== 'running') return idle;
      t += DT;
      return { ...idle, jumpHeld: Math.floor(t / 100) % 2 === 0 && t < 600 };
    });
    expect(game.result().gesturesDetected).toBe(1);
  });

  it('two players get a calmer course and wider timing windows', () => {
    const versus = getMode('versus');
    const required = courseForMode(versus).filter((c) => !isPickup(c.kind));
    for (let i = 1; i < required.length; i++) {
      expect((required[i]?.arriveAt ?? 0) - (required[i - 1]?.arriveAt ?? 0)).toBeGreaterThanOrEqual(2100);
    }

    // A jump that registers 300 ms after the barrier reached the runner (two trackers are slower)…
    const late = (g: GameEngine): PlayerInput => {
      const a = g.activeItem;
      return { ...idle, jumpHeld: a !== null && g.time >= a.arriveAt + 300 && g.time < a.arriveAt + 350 };
    };
    // …and one 850 ms before it.
    const early = (g: GameEngine): PlayerInput => {
      const a = g.activeItem;
      return { ...idle, jumpHeld: a !== null && g.time >= a.arriveAt - 850 && g.time < a.arriveAt - 800 };
    };
    for (const input of [late, early]) {
      const solo = new GameEngine([item(0, 'HURDLE', 4000)]);
      play(solo, input);
      expect(solo.result().obstacles[0]?.result).toBe('miss');
      const duo = new GameEngine([item(0, 'HURDLE', 4000)], undefined, rulesForMode(versus, 'body'));
      play(duo, input);
      expect(duo.result().obstacles[0]?.result).not.toBe('miss');
      expect(duo.airtimeMs).toBeGreaterThan(solo.airtimeMs);
    }
  });

  it('a slow device gets wider windows; a fast one keeps the standard ones', () => {
    expect(timingForRecognition(0)).toBeUndefined();
    expect(timingForRecognition(25)).toBeUndefined();
    const busy = timingForRecognition(10);
    const slow = timingForRecognition(6);
    expect(busy?.airtimeMs).toBeGreaterThan(GAME_CONFIG.airtimeMs);
    expect(slow?.clearGraceMs).toBeGreaterThan(busy?.clearGraceMs ?? 0);
  });

  it('the daily seed changes at midnight Astana time', () => {
    const morning = dailySeed(new Date('2026-09-30T03:00:00Z'));
    expect(dailySeed(new Date('2026-09-30T18:00:00Z'))).toBe(morning);
    // 19:00 UTC = 00:00 next day in Astana (UTC+5).
    expect(dailySeed(new Date('2026-09-30T19:30:00Z'))).not.toBe(morning);
  });
});