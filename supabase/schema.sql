-- MOTION//RUSH — global leaderboard.
-- Run once in Supabase → SQL Editor. Online duels need no tables (Realtime broadcast + presence).

create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text        not null check (char_length(name) between 2 and 20),
  mode        text        not null,
  score       integer     not null check (score between 0 and 1000000),
  accuracy    real        not null check (accuracy between 0 and 1),
  best_combo  integer     not null check (best_combo between 0 and 10000),
  scheme      text        not null check (scheme in ('body', 'seated')),
  -- Calendar day in Astana time (UTC+5), for the "today" board and the daily challenge.
  day         date        not null default ((now() at time zone 'Asia/Almaty')::date)
);

-- Ranked modes (re-run this block after adding a mode; it also upgrades an older table).
alter table public.scores drop constraint if exists scores_mode_check;
alter table public.scores add constraint scores_mode_check
  check (mode in ('classic', 'endless', 'sprint', 'blitz', 'daily', 'hardcore', 'jumpduck', 'lanes', 'dance'));

create index if not exists scores_mode_score_idx on public.scores (mode, score desc);
create index if not exists scores_mode_day_score_idx on public.scores (mode, day, score desc);

-- Anyone may read the board and add a run; nobody may edit or delete through the public key.
alter table public.scores enable row level security;

drop policy if exists "scores are public" on public.scores;
create policy "scores are public" on public.scores
  for select to anon, authenticated using (true);

drop policy if exists "anyone can submit a run" on public.scores;
create policy "anyone can submit a run" on public.scores
  for insert to anon, authenticated with check (true);
