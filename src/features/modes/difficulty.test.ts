import { describe, expect, it } from 'vitest';
import { COURSES, GAME_CONFIG } from '../../config/game.config';
import { FreezeGame } from '../arcade/freeze';
import { StarCatch } from '../arcade/starCatch';
import { generateCourse } from '../gameplay/course';
import { GameEngine, type PlayerInput } from '../gameplay/GameEngine';
import { isPickup, type Lane } from '../gameplay/types';
import { arcadeTune, difficultyOf, DIFFICULTIES, scaleCourse } from './difficulty';
import { courseForMode, effectiveDifficulty, getMode, GAME_MODES, rulesForMode, supportsDifficulty } from './modes';

const idle: PlayerInput = { trackable: true, lane: 0, jumpHeld: false, crouchHeld: false, diagnosis: null, hint: null };

/** A player who does every move right (jumps timed, not held). */
function perfect(g: GameEngine): PlayerInput {
  const expected = g.expected;
  const lane: Lane = expected === 'LEAN_LEFT' ? -1 : expected === 'LEAN_RIGHT' ? 1 : 0;
  const item = g.activeItem;
  const jumpHeld = expected === 'JUMP' && item !== null && item.arriveAt - g.time <= 450;
  return { ...idle, lane, jumpHeld, crouchHeld: expected === 'CROUCH' };
}

/** The standard course from one seed at a level (Classic Run's course). */
function required(level: Parameters<typeof difficultyOf>[0]) {
  return generateCourse(7, scaleCourse(COURSES.standard, difficultyOf(level))).filter((c) => !isPickup(c.kind));
}

describe('difficulty levels', () => {
  it('four levels, from forgiving to fast; harder ones are worth more points', () => {
    expect(DIFFICULTIES.map((d) => d.id)).toEqual(['easy', 'normal', 'hard', 'expert']);
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      expect(DIFFICULTIES[i]?.score ?? 0).toBeGreaterThan(DIFFICULTIES[i - 1]?.score ?? 0);
      expect(DIFFICULTIES[i]?.gap ?? 0).toBeLessThan(DIFFICULTIES[i - 1]?.gap ?? 0);
    }
  });

  it('a harder runner course has more obstacles that come faster', () => {
    const easy = required('easy');
    const normal = required('normal');
    const expert = required('expert');
    expect(easy.length).toBeLessThan(normal.length);
    expect(expert.length).toBeGreaterThan(normal.length);
    expect(Math.max(...expert.map((c) => c.leadMs))).toBeLessThan(Math.max(...normal.map((c) => c.leadMs)));
    // Normal is exactly the course the mode always had.
    expect(generateCourse(7, scaleCourse(COURSES.standard, difficultyOf('normal')))).toEqual(generateCourse(7, COURSES.standard));
  });

  it('lives: more on Easy, fewer on Expert, never zero — and Hardcore stays at one life', () => {
    const classic = getMode('classic');
    expect(rulesForMode(classic, 'body', 'easy').energy).toBe(GAME_CONFIG.energy + 2);
    expect(rulesForMode(classic, 'body', 'normal').energy).toBe(GAME_CONFIG.energy);
    expect(rulesForMode(classic, 'body', 'expert').energy).toBe(GAME_CONFIG.energy - 2);
    expect(rulesForMode(getMode('hardcore'), 'body', 'easy').energy).toBe(1);
    expect(rulesForMode(getMode('blitz'), 'body', 'expert').energy).toBe(1);
  });

  it('Easy gives more time for each move; harder levels never take time away', () => {
    const classic = getMode('classic');
    const easy = rulesForMode(classic, 'body', 'easy').timing;
    expect(easy?.clearGraceMs).toBeGreaterThan(GAME_CONFIG.clearGraceMs);
    expect(easy?.airtimeMs).toBeGreaterThan(GAME_CONFIG.airtimeMs);
    expect(rulesForMode(classic, 'body', 'expert').timing).toBeUndefined();
    // Two players keep their wider windows at every level.
    const versus = getMode('versus');
    expect(rulesForMode(versus, 'body', 'expert').timing).toEqual(versus.timing);
  });

  it('points scale with the level', () => {
    const scores = (['easy', 'normal', 'expert'] as const).map((level) => {
      // The same course for every level here; only the point value differs.
      const game = new GameEngine(generateCourse(3), undefined, { ...rulesForMode(getMode('classic'), 'body', level), timing: undefined });
      for (let t = 0; t < 200_000 && game.phase !== 'ended'; t += 16) game.update(16, perfect(game));
      return game.score;
    });
    expect(scores[0]).toBeLessThan(scores[1] ?? 0);
    expect(scores[2]).toBeGreaterThan(scores[1] ?? 0);
  });

  it('applies to the modes where it makes sense', () => {
    const off = GAME_MODES.filter((m) => !supportsDifficulty(m)).map((m) => m.id);
    expect(off.sort()).toEqual(['daily', 'duel', 'practice', 'reaction', 'squats']);
    // Practice, the daily course and the online duel always play the standard course.
    expect(effectiveDifficulty(getMode('practice'), 'expert').id).toBe('normal');
    expect(courseForMode(getMode('daily'), undefined, 'expert')).toEqual(courseForMode(getMode('daily')));
    expect(courseForMode(getMode('duel'), 5, 'expert')).toEqual(courseForMode(getMode('duel'), 5));
  });

  it('mini-games: a life more on Easy, one less on Expert', () => {
    expect(new StarCatch(1, arcadeTune(difficultyOf('easy'))).lives).toBe(4);
    expect(new StarCatch(1, arcadeTune(difficultyOf('expert'))).lives).toBe(2);
    expect(new FreezeGame(1, arcadeTune(difficultyOf('normal'))).lives).toBe(3);
  });
});
