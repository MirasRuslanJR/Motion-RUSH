import { describe, expect, it } from 'vitest';
import type { ObstacleRecord, SessionResult } from '../gameplay/types';
import { ACHIEVEMENTS, addSession, IMMORTAL_MS, NO_ACHIEVEMENTS, runnerFacts, type AchievementState, type SessionFacts } from './achievements';

const quiet: SessionFacts = { dodges: 0, perfectStreak: 0, durationMs: 30_000, score: 100 };

function obstacle(result: ObstacleRecord['result']): ObstacleRecord {
  return { id: 0, kind: 'HURDLE', arriveAt: 0, required: 'JUMP', result, leadMs: null, hadErrorHint: false, corrected: false, missReason: null };
}

describe('achievements', () => {
  it('the first game unlocks FIRST MOVE, once', () => {
    const first = addSession(NO_ACHIEVEMENTS, quiet);
    expect(first.unlocked).toEqual(['first-move']);
    expect(addSession(first.state, quiet).unlocked).toEqual([]);
  });

  it('NOPE counts dodges over all games', () => {
    let state: AchievementState = NO_ACHIEVEMENTS;
    const got: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = addSession(state, { ...quiet, dodges: 12 });
      state = r.state;
      got.push(...r.unlocked);
    }
    expect(state.dodges).toBe(60);
    expect(got).toContain('nope');
  });

  it('INSANE, IMMORTAL and TOO FAST come from one game; all five unlock MOTION MASTER', () => {
    const r = addSession(NO_ACHIEVEMENTS, { dodges: 50, perfectStreak: 10, durationMs: IMMORTAL_MS, score: 5000 });
    expect(r.unlocked).toEqual(ACHIEVEMENTS.map((a) => a.id));
    expect(r.state.unlocked).toHaveLength(ACHIEVEMENTS.length);
    expect(addSession(NO_ACHIEVEMENTS, { dodges: 0, perfectStreak: 9, durationMs: IMMORTAL_MS - 1, score: 4999 }).unlocked).toEqual(['first-move']);
  });

  it('a runner game: cleared obstacles are dodges, the longest run of PERFECT ones in a row counts', () => {
    const results: ObstacleRecord['result'][] = ['perfect', 'perfect', 'good', 'perfect', 'perfect', 'perfect', 'miss', 'perfect'];
    const run = { obstacles: results.map(obstacle), durationMs: 70_000, score: 1200 } as SessionResult;
    expect(runnerFacts(run)).toEqual({ dodges: 7, perfectStreak: 3, durationMs: 70_000, score: 1200 });
  });
});
