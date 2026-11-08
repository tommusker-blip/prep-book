-- G1: games and their engine analysis, one row per game, instead of the single "games" and
-- "acc" documents in prep_data (which grew to ~850 KB and were re-sent whole on every change).
-- The old documents are left in prep_data as a backup; the app stops writing them once the
-- games have been copied here (settings.gamesInTable).

create table public.games (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  id         text        not null,            -- the app's game id (hash of the chess.com link)
  played_on  date,                            -- for sorting and future filtering
  color      text check (color in ('white', 'black')),
  game       jsonb       not null,            -- {id, my, tc, tcs, url, date, white, black, welo, belo, result, moves, clk}
  analysis   jsonb,                           -- {v, d, ev, bm, inb, post, exitCp} or null
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index games_user_updated on public.games (user_id, updated_at);

alter table public.games enable row level security;
create policy "read own"   on public.games for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own" on public.games for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own" on public.games for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own" on public.games for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.games to authenticated;

-- Same server-side timestamp as prep_data (the function just sets updated_at = now())
create trigger games_updated_at
  before insert or update on public.games
  for each row execute function public.prep_data_set_updated_at();
