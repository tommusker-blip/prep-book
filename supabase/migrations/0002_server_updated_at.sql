-- Let the database, not the client clock, set updated_at on every write,
-- so sync between devices doesn't depend on each device's clock.
-- Already applied on the live project (checked 2026-11-07).

create or replace function public.prep_data_set_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger prep_data_updated_at
  before insert or update on public.prep_data
  for each row execute function public.prep_data_set_updated_at();
