import type { SessionResult } from '../gameplay/types';

export type AchievementId = 'first-move' | 'nope' | 'insane' | 'immortal' | 'too-fast' | 'motion-master';

export interface AchievementDef {
  id: AchievementId;
  title: string;
  text: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-move', title: 'FIRST MOVE', text: 'Сыграть первый раз' },
  { id: 'nope', title: 'NOPE', text: 'Увернуться 50 раз' },
  { id: 'insane', title: 'INSANE', text: '10 идеальных уклонений подряд' },
  { id: 'immortal', title: 'IMMORTAL', text: 'Продержаться 3 минуты в одной игре' },
  { id: 'too-fast', title: 'TOO FAST', text: 'Набрать 5 000 очков за игру' },
  { id: 'motion-master', title: 'MOTION MASTER', text: 'Открыть все достижения' },
];

export const NOPE_DODGES = 50;
export const INSANE_STREAK = 10;
export const IMMORTAL_MS = 180_000;
export const TOO_FAST_SCORE = 5000;

/** What one finished game adds. */
export interface SessionFacts {
  /** Obstacles cleared and boss attacks dodged. */
  dodges: number;
  /** Longest run of perfect dodges in a row. */
  perfectStreak: number;
  durationMs: number;
  score: number;
}

/** Progress kept in the profile. */
export interface AchievementState {
  unlocked: AchievementId[];
  /** Dodges over all games, for NOPE. */
  dodges: number;
}

export const NO_ACHIEVEMENTS: AchievementState = { unlocked: [], dodges: 0 };

export function achievementOf(id: AchievementId): AchievementDef {
  return ACHIEVEMENTS.find((a) => a.id === id) ?? (ACHIEVEMENTS[0] as AchievementDef);
}

/** A finished game: the new progress and the achievements this game unlocked, in list order. */
export function addSession(state: AchievementState, facts: SessionFacts): { state: AchievementState; unlocked: AchievementId[] } {
  const dodges = state.dodges + Math.max(0, facts.dodges);
  const have = new Set(state.unlocked);
  const earned: Record<AchievementId, boolean> = {
    'first-move': true,
    nope: dodges >= NOPE_DODGES,
    insane: facts.perfectStreak >= INSANE_STREAK,
    immortal: facts.durationMs >= IMMORTAL_MS,
    'too-fast': facts.score >= TOO_FAST_SCORE,
    'motion-master': false,
  };
  const fresh: AchievementId[] = [];
  for (const a of ACHIEVEMENTS) {
    if (a.id === 'motion-master') continue;
    if (earned[a.id] && !have.has(a.id)) {
      have.add(a.id);
      fresh.push(a.id);
    }
  }
  if (!have.has('motion-master') && ACHIEVEMENTS.every((a) => a.id === 'motion-master' || have.has(a.id))) {
    have.add('motion-master');
    fresh.push('motion-master');
  }
  return { state: { unlocked: ACHIEVEMENTS.map((a) => a.id).filter((id) => have.has(id)), dodges }, unlocked: fresh };
}

/** A runner game: every cleared obstacle is a dodge; the longest run of PERFECT clears in a row. */
export function runnerFacts(result: SessionResult): SessionFacts {
  let streak = 0;
  let best = 0;
  let dodges = 0;
  for (const o of result.obstacles) {
    if (o.result !== 'miss') dodges++;
    streak = o.result === 'perfect' ? streak + 1 : 0;
    best = Math.max(best, streak);
  }
  return { dodges, perfectStreak: best, durationMs: result.durationMs, score: result.score };
}
