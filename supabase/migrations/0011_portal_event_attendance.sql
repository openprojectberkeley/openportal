-- Attendance for portal events.
--
-- `portal_event_attendance` records, per member per event, whether they were
-- present/absent/excused. It's the junction between `members` and
-- `portal_events` (both from 0006). Portal admins take attendance for their
-- portal's events; ordinary members can only read their own rows.
--
-- Mirrors the junction-table + RLS pattern from 0006_portals.sql. `recorded_by`
-- captures which admin last wrote the row (mirrors `created_by` on portal_events).

create table if not exists public.portal_event_attendance (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.portal_events(id) on delete cascade,
  user_id     uuid not null references public.members(user_id) on delete cascade,
  status      text not null default 'present'
              check (status in ('present', 'absent', 'excused')),
  recorded_by uuid references public.members(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (event_id, user_id)
);

create index if not exists portal_event_attendance_event_id_idx
  on public.portal_event_attendance(event_id);
create index if not exists portal_event_attendance_user_id_idx
  on public.portal_event_attendance(user_id);

-- Admin of the portal that owns a given event. Bridges an event id to the
-- existing is_portal_admin() check (0006) so RLS can gate by portal admin
-- without the client passing the portal id. security definer + stable, like
-- the other role helpers.
create or replace function public.is_event_portal_admin(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.portal_events e
    where e.id = p_event_id
      and public.is_portal_admin(e.portal_id)
  );
$$;

grant execute on function public.is_event_portal_admin(uuid) to authenticated;

alter table public.portal_event_attendance enable row level security;

-- SELECT: a member sees their own attendance; a portal admin sees every row for
-- their portal's events.
drop policy if exists "portal_event_attendance_select" on public.portal_event_attendance;
create policy "portal_event_attendance_select"
on public.portal_event_attendance
for select
to authenticated
using ( user_id = auth.uid() or public.is_event_portal_admin(event_id) );

-- INSERT: portal admins only, and the row must be attributed to themselves
-- (mirrors the created_by = auth.uid() guard on portal_events inserts).
drop policy if exists "portal_event_attendance_insert" on public.portal_event_attendance;
create policy "portal_event_attendance_insert"
on public.portal_event_attendance
for insert
to authenticated
with check ( public.is_event_portal_admin(event_id) and recorded_by = auth.uid() );

-- UPDATE: portal admins only; the row stays attributed to the editing admin.
drop policy if exists "portal_event_attendance_update" on public.portal_event_attendance;
create policy "portal_event_attendance_update"
on public.portal_event_attendance
for update
to authenticated
using ( public.is_event_portal_admin(event_id) )
with check ( public.is_event_portal_admin(event_id) and recorded_by = auth.uid() );

-- DELETE: portal admins only.
drop policy if exists "portal_event_attendance_delete" on public.portal_event_attendance;
create policy "portal_event_attendance_delete"
on public.portal_event_attendance
for delete
to authenticated
using ( public.is_event_portal_admin(event_id) );
