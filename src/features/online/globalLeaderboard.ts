import { astanaDay, supabase } from '../../lib/supabase';
import type { ControlScheme } from '../gestures/types';

export interface GlobalScore {
  name: string;
  score: number;
  accuracy: number;
  best_combo: number;
  scheme: ControlScheme;
  created_at: string;
}

export interface ScoreSubmission {
  name: string;
  mode: string;
  score: number;
  accuracy: number;
  bestCombo: number;
  scheme: ControlScheme;
}

/** Sends a finished run to the global table. Returns false when offline / not configured. */
export async function submitScore(entry: ScoreSubmission): Promise<boolean> {
  const db = await supabase();
  if (!db) return false;
  const { error } = await db.from('scores').insert({
    name: entry.name,
    mode: entry.mode,
    score: Math.round(entry.score),
    accuracy: Math.round(entry.accuracy * 1000) / 1000,
    best_combo: entry.bestCombo,
    scheme: entry.scheme,
    day: astanaDay(),
  });
  return !error;
}

/** All time, the last 7 days (today included) or today — calendar days in Astana time. */
export type LeaderboardPeriod = 'all' | 'week' | 'today';

export const PERIOD_TITLES: Record<LeaderboardPeriod, string> = { all: 'Всё время', week: 'Неделя', today: 'Сегодня' };

/** The first Astana calendar day a period covers, null for all time. */
export function periodStart(period: LeaderboardPeriod, now: Date = new Date()): string | null {
  if (period === 'today') return astanaDay(now);
  if (period === 'week') return astanaDay(new Date(now.getTime() - 6 * 86400000));
  return null;
}

/** Top scores of a mode for a period. null = backend unavailable. */
export async function fetchTopScores(mode: string, period: LeaderboardPeriod, limit = 20): Promise<GlobalScore[] | null> {
  const db = await supabase();
  if (!db) return null;
  let query = db
    .from('scores')
    .select('name, score, accuracy, best_combo, scheme, created_at')
    .eq('mode', mode)
    .order('score', { ascending: false })
    .limit(limit);
  const from = periodStart(period);
  if (period === 'today' && from) query = query.eq('day', from);
  else if (from) query = query.gte('day', from);
  const { data, error } = await query;
  if (error) return null;
  return (data ?? []) as GlobalScore[];
}
