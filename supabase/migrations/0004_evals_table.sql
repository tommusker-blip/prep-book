-- G2: Stockfish results by position, so analysis done on one device is instantly available on
-- the others. Only interactive analyses (depth 14 and up) are stored here; per-move game
-- analysis lives with each game in public.games.

create table public.evals (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  key        text        not null,            -- position key: first four FEN fields (K() in the app)
  depth      smallint    not null,
  data       jsonb       not null,            -- {cp, mate, best, pv, d, e}; cp is from the side to move
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.evals enable row level security;
create policy "read own"   on public.evals for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own" on public.evals for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own" on public.evals for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own" on public.evals for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.evals to authenticated;

create trigger evals_updated_at
  before insert or update on public.evals
  for each row execute function public.prep_data_set_updated_at();
