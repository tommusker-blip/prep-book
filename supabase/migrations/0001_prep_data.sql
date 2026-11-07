-- Prep Book: one row per (user, document). Documents: white, black, settings, games, acc.
-- Applied by hand through the SQL Editor on first setup; saved here so the schema lives in the repo.

create table public.prep_data (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  doc        text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, doc)
);

alter table public.prep_data enable row level security;

create policy "read own"   on public.prep_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own" on public.prep_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own" on public.prep_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own" on public.prep_data for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.prep_data to authenticated;
