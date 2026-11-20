-- ScoreGame leaderboard. Paste into the Supabase SQL editor and run once.
-- One row per player per board. Anyone may read; scores go in only through submit_score,
-- which keeps whichever is higher, so a bad run never lowers a best.

create table if not exists scores (
  board text not null check (char_length(board) between 1 and 32),
  name text not null check (char_length(name) between 1 and 16),
  score integer not null check (score between 1 and 9999),
  updated_at timestamptz not null default now(),
  primary key (board, name)
);

alter table scores enable row level security;

drop policy if exists "anyone can read scores" on scores;
create policy "anyone can read scores" on scores for select using (true);

create or replace function submit_score(p_board text, p_name text, p_score integer)
returns void
language sql
security definer
set search_path = public
as $$
  insert into scores (board, name, score)
  values (p_board, p_name, p_score)
  on conflict (board, name) do update
    set score = excluded.score, updated_at = now()
    where excluded.score > scores.score;
$$;

grant execute on function submit_score(text, text, integer) to anon;
