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
  name?: string;
}

export interface Profile {
  /** Best score across all modes (landing screen). */
  bestScore: number;
  bestCombo: number;
  sessions: number;
  /** Local top scores per game mode. */
  leaderboards: Record<string, LeaderboardEntry[]>;
  muted: boolean;
  /** Name shown on the global leaderboard and in online duels. */
  nickname: string;
  /** Random id for online presence (not personal data). */
  playerId: string;
}

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const EMPTY = (): Profile => ({
  bestScore: 0,
  bestCombo: 0,
  sessions: 0,
  leaderboards: {},
  muted: false,
  nickname: '',
  playerId: randomId(),
});

/** localStorage can throw (private mode, blocked storage) — the app must still work. */
export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const fresh = EMPTY();
      saveProfile(fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<Profile> & { leaderboard?: LeaderboardEntry[] };
    const profile: Profile = { ...EMPTY(), ...parsed, leaderboards: { ...(parsed.leaderboards ?? {}) } };
    // v1 kept one list — it belongs to the classic mode.
    if (parsed.leaderboard && !profile.leaderboards.classic) profile.leaderboards.classic = parsed.leaderboard;
    if (!parsed.playerId) saveProfile(profile);
    return profile;
  } catch {
    return EMPTY();
  }
}

function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Storage unavailable: progress simply is not persisted.
  }
}

export function bestFor(profile: Profile, mode: string): number {
  return profile.leaderboards[mode]?.[0]?.score ?? 0;
}

export interface RecordedSession {
  profile: Profile;
  mode: string;
  /** 1-based rank in the local leaderboard of this mode, null if it did not make it. */
  rank: number | null;
  isNewBest: boolean;
  previousBest: number;
}

export function recordSession(mode: string, entry: LeaderboardEntry): RecordedSession {
  const profile = loadProfile();
  const previousBest = bestFor(profile, mode);
  const board = [...(profile.leaderboards[mode] ?? []), entry]
    .sort((a, b) => b.score - a.score || b.accuracy - a.accuracy)
    .slice(0, LEADERBOARD_SIZE);
  const index = board.indexOf(entry);
  const next: Profile = {
    ...profile,
    sessions: profile.sessions + 1,
    bestScore: Math.max(profile.bestScore, entry.score),
    bestCombo: Math.max(profile.bestCombo, entry.bestCombo),
    leaderboards: { ...profile.leaderboards, [mode]: board },
  };
  saveProfile(next);
  return { profile: next, mode, rank: index >= 0 ? index + 1 : null, isNewBest: entry.score > previousBest, previousBest };
}

export function saveMuted(muted: boolean): void {
  saveProfile({ ...loadProfile(), muted });
}

/** 2–20 visible characters; trimmed. */
export function cleanNickname(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 20);
}

export function saveNickname(name: string): Profile {
  const next = { ...loadProfile(), nickname: cleanNickname(name) };
  saveProfile(next);
  return next;
}
