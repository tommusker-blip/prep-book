-- v0.9.57: slow-to-rebuild data kept in the database, so it survives on every device and isn't
-- forgotten when the browser's storage fills up. One table, a row per item, by kind:
--   expl     Lichess opening explorer data, key = position key | rating band (or "masters")
--   ideas    "Find ideas" results for one position, key = position key | rating band
--   idealine an idea line (Train > Ideas worth learning), key = book | colour | path
-- Only the signed-in user can read or write their own rows.

create table public.stash (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text        not null,
  key        text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, key)
);

alter table public.stash enable row level security;
create policy "read own"   on public.stash for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own" on public.stash for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own" on public.stash for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own" on public.stash for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.stash to authenticated;

create trigger stash_updated_at
  before insert or update on public.stash
  for each row execute function public.prep_data_set_updated_at();
