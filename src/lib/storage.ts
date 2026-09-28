import type { GameOutcome } from '../features/gameplay/types';

const KEY = 'motion-rush:v1';
const LEADERBOARD_SIZE = 8;

export interface LeaderboardEntry {
  score: number;
  /** 0..1 */
  accuracy: number;
  bestCombo: number;
  outcome: GameOutcome;
  /** ISO timestamp. */
  date: string;
}

export interface Profile {
  bestScore: number;
  bestCombo: number;
  sessions: number;
  leaderboard: LeaderboardEntry[];
  muted: boolean;
}

const EMPTY: Profile = { bestScore: 0, bestCombo: 0, sessions: 0, leaderboard: [], muted: false };

function isProfile(value: unknown): value is Profile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.bestScore === 'number' && typeof v.sessions === 'number' && Array.isArray(v.leaderboard);
}

/** localStorage can throw (private mode, blocked storage) — the app must still work. */
export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed: unknown = JSON.parse(raw);
    return isProfile(parsed) ? { ...EMPTY, ...parsed } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Storage unavailable: progress simply is not persisted.
  }
}

export interface RecordedSession {
  profile: Profile;
  /** 1-based rank in the local leaderboard, null if it did not make it. */
  rank: number | null;
  isNewBest: boolean;
  previousBest: number;
}

export function recordSession(entry: LeaderboardEntry): RecordedSession {
  const profile = loadProfile();
  const previousBest = profile.bestScore;
  const leaderboard = [...profile.leaderboard, entry]
    .sort((a, b) => b.score - a.score || b.accuracy - a.accuracy)
    .slice(0, LEADERBOARD_SIZE);
  const index = leaderboard.indexOf(entry);
  const next: Profile = {
    ...profile,
    sessions: profile.sessions + 1,
    bestScore: Math.max(profile.bestScore, entry.score),
    bestCombo: Math.max(profile.bestCombo, entry.bestCombo),
    leaderboard,
  };
  saveProfile(next);
  return { profile: next, rank: index >= 0 ? index + 1 : null, isNewBest: entry.score > previousBest, previousBest };
}

export function saveMuted(muted: boolean): void {
  saveProfile({ ...loadProfile(), muted });
}
