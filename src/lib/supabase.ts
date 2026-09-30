import type { SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Online features (global leaderboard, duels) are on only when the project is configured. */
export const ONLINE_ENABLED = Boolean(URL && KEY);

let client: Promise<SupabaseClient | null> | undefined;

/**
 * Lazily created client, or null when Supabase is not configured.
 * The SDK is a separate chunk: players who never go online do not download it.
 */
export function supabase(): Promise<SupabaseClient | null> {
  client ??=
    URL && KEY
      ? import('@supabase/supabase-js')
          .then(({ createClient }) => createClient(URL, KEY, { auth: { persistSession: false } }))
          .catch(() => null)
      : Promise.resolve(null);
  return client;
}

/** Calendar day in Astana time (UTC+5), as YYYY-MM-DD — used for daily boards. */
export function astanaDay(date: Date = new Date()): string {
  return new Date(date.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}
