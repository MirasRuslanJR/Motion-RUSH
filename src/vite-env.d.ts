/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL — enables the global leaderboard and online duels. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (public) key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
