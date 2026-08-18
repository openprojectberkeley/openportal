-- Make an application period's `status` the authoritative open/closed switch,
-- decoupled from its start/end window.
--
-- 0022 defined `applications_open()` / `current_application_period()` to require
-- `status = 'open'` AND now() within [starts_at, ends_at). That tied "are
-- applications open?" to the schedule, so exec couldn't open a period early
-- (before its start) or keep an "Open (outside window)" period actually open
-- without moving its dates.
--
-- Now `status = 'open'` alone opens applications. The start/end window becomes an
-- informational schedule (surfaced in the manager UI as "Open now" vs "Open
-- (outside window)"), not a gate. Idempotent redefinition — safe to run whether or
-- not a prior 0022 already applied the window-based versions.

create or replace function public.applications_open()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.application_periods p
    where p.status = 'open'
  );
$$;

grant execute on function public.applications_open() to authenticated;

create or replace function public.current_application_period()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from public.application_periods
  order by (status = 'open') desc,
           created_at desc
  limit 1;
$$;

grant execute on function public.current_application_period() to authenticated;
