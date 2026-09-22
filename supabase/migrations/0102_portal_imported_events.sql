-- Import club events into a portal's attendance sheet.
--
-- The club attendance sheet (0095) lists every active member against every
-- club event, which is unworkable for a PM who only cares about their own
-- project's people. `portal_imported_events` lets a portal admin pin a club
-- event (portal_id null — a GM, a workshop, …) into their portal, so it shows
-- up as a column in that portal's attendance grid next to its own events.
--
-- The link is display-only: attendance is still one row per (event, member) in
-- portal_event_attendance, so a mark made from a project portal and a mark
-- made from the club sheet are the same row. Deleting the import never touches
-- attendance.

create table if not exists public.portal_imported_events (
  portal_id   uuid not null references public.portals(id) on delete cascade,
  event_id    uuid not null references public.portal_events(id) on delete cascade,
  imported_by uuid references public.members(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (portal_id, event_id)
);

create index if not exists portal_imported_events_event_id_idx
  on public.portal_imported_events(event_id);

-- Only club events can be imported, and never board-only ones: a portal's
-- members must be able to see every event in its sheet. security definer so
-- the check sees the event regardless of the caller's own read access.
create or replace function public.is_importable_club_event(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.portal_events e
    where e.id = p_event_id
      and e.portal_id is null
      and e.category <> 'board'
  );
$$;

grant execute on function public.is_importable_club_event(uuid) to authenticated;

alter table public.portal_imported_events enable row level security;

drop policy if exists "portal_imported_events_select" on public.portal_imported_events;
create policy "portal_imported_events_select"
on public.portal_imported_events
for select
to authenticated
using ( public.is_portal_member(portal_id) );

drop policy if exists "portal_imported_events_insert" on public.portal_imported_events;
create policy "portal_imported_events_insert"
on public.portal_imported_events
for insert
to authenticated
with check (
  public.is_portal_admin(portal_id)
  and imported_by = auth.uid()
  and public.is_importable_club_event(event_id)
);

drop policy if exists "portal_imported_events_delete" on public.portal_imported_events;
create policy "portal_imported_events_delete"
on public.portal_imported_events
for delete
to authenticated
using ( public.is_portal_admin(portal_id) );

-- Attendance at a club event: board/exec as before (0095; PMs are included via
-- is_pm()), plus the admin of any portal that imported it — a non-board portal
-- admin who imports a GM has to be able to mark it.
create or replace function public.can_take_event_attendance(p_event_id uuid)
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
      and case
            when e.portal_id is null then
              public.is_board_or_exec()
              or exists (
                select 1 from public.portal_imported_events i
                where i.event_id = e.id
                  and public.is_portal_admin(i.portal_id)
              )
            else public.is_portal_admin(e.portal_id)
          end
  );
$$;
