-- Grant President the same special capabilities VP Tech has (both already
-- have exec-level access_level, so this only affects the two things gated on
-- the literal "VP Tech" role rather than on exec in general):
--
--   1. is_president(): mirrors is_vp_tech() (0004), just checking role_name =
--      'President'.
--   2. is_vp_tech_or_president(): the combinator used everywhere the coffee-
--      chat booking window (app_settings) write was previously VP-Tech-only.
--      Replaces the "_vp_tech" policies with generically-named ones (same
--      idempotent drop/create pattern as every prior policy rename in this
--      repo, e.g. 0033's project_members_select).
--
-- Not touched: the "view as" role-simulation toggle (app-side only — see
-- src/lib/roles.ts's ELEVATED_ROLE_NAMES, no DB object backs it) and the
-- send-support-email recipient list (deliberately left VP-Tech-only; a
-- support-routing decision, not a permission).

create or replace function public.is_president()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.members_roles mr
    join public.roles r on r.id = mr.role_id
    where mr.user_id = auth.uid()
      and r.role_name = 'President'
  );
$$;

grant execute on function public.is_president() to authenticated;

create or replace function public.is_vp_tech_or_president()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_vp_tech() or public.is_president();
$$;

grant execute on function public.is_vp_tech_or_president() to authenticated;

drop policy if exists "app_settings_insert_vp_tech" on public.app_settings;
drop policy if exists "app_settings_insert" on public.app_settings;
create policy "app_settings_insert"
on public.app_settings
for insert
to authenticated
with check ( public.is_vp_tech_or_president() );

drop policy if exists "app_settings_update_vp_tech" on public.app_settings;
drop policy if exists "app_settings_update" on public.app_settings;
create policy "app_settings_update"
on public.app_settings
for update
to authenticated
using ( public.is_vp_tech_or_president() )
with check ( public.is_vp_tech_or_president() );
