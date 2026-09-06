-- Per-person extended access to a closed application period.
--
-- application_periods.status is a single global open/closed switch (0022,
-- 0023) -- there was previously no way to let one specific applicant keep
-- submitting/editing after a period closes for everyone else. This adds:
--
--   1. application_period_access: (period_id, user_id) grants. user_id
--      references public.members(user_id) (not auth.users directly) so the
--      admin UI can pick a person from a name-search dropdown over `members`
--      -- the same table/pattern the portal and project member pickers
--      already use (add-member-picker.tsx) -- and so the grants list can
--      embed-join members for display. Read/write is a single policy gated
--      to VP Tech or President (public.is_vp_tech_or_president(), 0047) --
--      the same restriction as the coffee-chat booking window, deliberately
--      narrower than is_exec() since this is a review-integrity-sensitive
--      override. No email lookup / SECURITY DEFINER RPC is needed: the
--      client already has the target's user_id from the picker, so grant/
--      revoke are plain table writes under RLS (mirrors application_periods
--      itself, 0022).
--   2. period_is_open_for(period_id): applications_open() (0023) generalized
--      to "open, or the current user has an explicit grant for this period."
--      Replaces applications_open() in the applicant write policies on
--      applications / application_rankings / application_answers so an
--      allowlisted applicant's writes succeed even once the period is
--      closed. applications_open() itself is untouched -- it still means
--      "is *some* period open" for any other caller.
--   3. my_open_application_period(): the period id the current applicant
--      should load -- the open one, or one they hold a grant for. Replaces
--      the client's direct `status = 'open'` query in application/page.tsx.

-- An earlier iteration of this migration shipped an email-based version
-- (email column, user_id -> auth.users, grant/revoke as SECURITY DEFINER
-- RPCs, select-only RLS). Drop that version's RPCs and converge the table
-- below onto the current shape, so this file is safe to (re-)run against a
-- database that already has either version applied.
drop function if exists public.grant_application_period_access(uuid, text);
drop function if exists public.revoke_application_period_access(uuid, uuid);

create table if not exists public.application_period_access (
  id         uuid primary key default gen_random_uuid(),
  period_id  uuid not null references public.application_periods(id) on delete cascade,
  user_id    uuid not null references public.members(user_id) on delete cascade,
  granted_by uuid references public.members(user_id) on delete set null default auth.uid(),
  granted_at timestamptz not null default now(),
  unique (period_id, user_id)
);

alter table public.application_period_access drop column if exists email;
alter table public.application_period_access alter column granted_by set default auth.uid();
alter table public.application_period_access drop constraint if exists application_period_access_user_id_fkey;
alter table public.application_period_access
  add constraint application_period_access_user_id_fkey
  foreign key (user_id) references public.members(user_id) on delete cascade;
alter table public.application_period_access drop constraint if exists application_period_access_granted_by_fkey;
alter table public.application_period_access
  add constraint application_period_access_granted_by_fkey
  foreign key (granted_by) references public.members(user_id) on delete set null;

alter table public.application_period_access enable row level security;

-- VP Tech/President manage grants directly (list/add/remove) -- no RPC layer.
drop policy if exists "application_period_access_select" on public.application_period_access;
drop policy if exists "application_period_access_write" on public.application_period_access;
create policy "application_period_access_write"
on public.application_period_access
for all
to authenticated
using ( public.is_vp_tech_or_president() )
with check ( public.is_vp_tech_or_president() );

-- Is this period open for the current user -- either globally open, or they
-- hold an explicit grant for it? Used in place of applications_open() in the
-- write policies below, where the row's period_id is known.
create or replace function public.period_is_open_for(p_period_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.application_periods p
    where p.id = p_period_id and p.status = 'open'
  )
  or exists (
    select 1 from public.application_period_access a
    where a.period_id = p_period_id and a.user_id = auth.uid()
  );
$$;

grant execute on function public.period_is_open_for(uuid) to authenticated;

-- The period id an applicant should load: the open one, or one they hold a
-- grant for (even though it's closed for everyone else).
create or replace function public.my_open_application_period()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select p.id
  from public.application_periods p
  where p.status = 'open'
     or exists (
       select 1 from public.application_period_access a
       where a.period_id = p.id and a.user_id = auth.uid()
     )
  order by (p.status = 'open') desc, p.created_at desc
  limit 1;
$$;

grant execute on function public.my_open_application_period() to authenticated;

-- Re-gate applicant writes on period_is_open_for(<row's period>) instead of
-- the global applications_open() (same policies, same shape, as 0022).

drop policy if exists "applications_insert" on public.applications;
create policy "applications_insert"
on public.applications
for insert
to authenticated
with check ( applicant_id = auth.uid() and public.period_is_open_for(period_id) );

drop policy if exists "applications_update" on public.applications;
create policy "applications_update"
on public.applications
for update
to authenticated
using ( applicant_id = auth.uid() and public.period_is_open_for(period_id) )
with check ( applicant_id = auth.uid() and public.period_is_open_for(period_id) );

drop policy if exists "application_rankings_insert" on public.application_rankings;
create policy "application_rankings_insert"
on public.application_rankings
for insert
to authenticated
with check (
  exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
      and public.period_is_open_for(a.period_id)
  )
  and (
    public.is_returning_member()
    or exists (
      select 1 from public.projects p
      where p.id = application_rankings.project_id and p.type = 'launch'
    )
  )
);

drop policy if exists "application_rankings_update" on public.application_rankings;
create policy "application_rankings_update"
on public.application_rankings
for update
to authenticated
using (
  exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
      and public.period_is_open_for(a.period_id)
  )
  and (
    public.is_returning_member()
    or exists (
      select 1 from public.projects p
      where p.id = application_rankings.project_id and p.type = 'launch'
    )
  )
);

drop policy if exists "application_rankings_delete" on public.application_rankings;
create policy "application_rankings_delete"
on public.application_rankings
for delete
to authenticated
using (
  exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
      and public.period_is_open_for(a.period_id)
  )
);

drop policy if exists "application_answers_insert" on public.application_answers;
create policy "application_answers_insert"
on public.application_answers
for insert
to authenticated
with check (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
      and public.period_is_open_for(a.period_id)
  )
);

drop policy if exists "application_answers_update" on public.application_answers;
create policy "application_answers_update"
on public.application_answers
for update
to authenticated
using (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
      and public.period_is_open_for(a.period_id)
  )
);

drop policy if exists "application_answers_delete" on public.application_answers;
create policy "application_answers_delete"
on public.application_answers
for delete
to authenticated
using (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
      and public.period_is_open_for(a.period_id)
  )
);
