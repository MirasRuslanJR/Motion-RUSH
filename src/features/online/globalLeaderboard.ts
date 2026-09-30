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

/** Top scores of a mode (all time or today). null = backend unavailable. */
export async function fetchTopScores(mode: string, period: 'all' | 'today', limit = 20): Promise<GlobalScore[] | null> {
  const db = await supabase();
  if (!db) return null;
  let query = db
    .from('scores')
    .select('name, score, accuracy, best_combo, scheme, created_at')
    .eq('mode', mode)
    .order('score', { ascending: false })
    .limit(limit);
  if (period === 'today') query = query.eq('day', astanaDay());
  const { data, error } = await query;
  if (error) return null;
  return (data ?? []) as GlobalScore[];
}
