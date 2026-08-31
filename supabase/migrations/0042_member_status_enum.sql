-- Replace the boolean members.active with a 4-state status enum.
--
--   1. member_status enum (active/inactive/non_member/blacklisted) + new
--      members.status column, default 'non_member'. Backfills from the old
--      `active` boolean (true -> 'active', false/null -> 'non_member' — there's
--      no historical data to distinguish rolled-off members or blacklisted
--      users, so this is a documented, accepted gap), then drops `active`.
--   2. is_returning_member() now checks status in ('active','inactive') — an
--      inactive (rolled-off) member still counts as "has been an accepted
--      member before" for OP Studio application eligibility, same as before
--      for active members.
--   3. accept_application() sets status = 'active' unconditionally on accept
--      (regardless of prior status), and its own Studio-eligibility guard is
--      realigned to the same status in ('active','inactive') check used by
--      is_returning_member(), instead of checking the raw column directly —
--      letting the two diverge would be a silent trap for whoever edits either
--      one next.
--   4. set_member_status(p_user_id, p_status): new SECURITY DEFINER RPC,
--      board/exec-gated (reuses is_board_or_exec()), backing the admin members
--      tab's status control. Any of the 4 enum values is a legal target,
--      including non_member (an explicit "revoke membership" action).
--   5. members_status_guard trigger: defense-in-depth so a member can't set
--      their own status via a direct client write (the dashboard-managed RLS
--      on `members` isn't visible from migration history, so this can't be
--      verified from here — the trigger is a no-cost safety net that doesn't
--      affect set_member_status or accept_application, both already board/
--      exec-gated).
--
-- No RLS policy bodies changed: application_rankings_insert/update (0022) call
-- is_returning_member() rather than referencing `active` directly, so
-- redefining the function is sufficient.
--
-- Scope note: `blacklisted` is a label only for now. No RLS blocks a
-- blacklisted user from submitting an application — deliberately out of scope,
-- revisit later if needed.

-- 1. enum + column + backfill + drop old column -------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'member_status') then
    create type public.member_status as enum ('active', 'inactive', 'non_member', 'blacklisted');
  end if;
end $$;

alter table public.members
  add column if not exists status public.member_status not null default 'non_member';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'members' and column_name = 'active'
  ) then
    update public.members
    set status = case when active then 'active' else 'non_member' end::public.member_status;

    alter table public.members drop column active;
  end if;
end $$;

-- 2. is_returning_member(): inactive still counts as returning ----------------

create or replace function public.is_returning_member()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = auth.uid() and m.status in ('active', 'inactive')
  );
$$;

grant execute on function public.is_returning_member() to authenticated;

-- 3. accept_application(): status = 'active' on accept, guard realigned -------

create or replace function public.accept_application(p_application_id uuid, p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applicant uuid;
begin
  if not public.is_board_or_exec() then
    raise exception 'not authorized';
  end if;

  select applicant_id into v_applicant
  from public.applications
  where id = p_application_id;

  if v_applicant is null then
    raise exception 'application not found';
  end if;

  -- First-time applicants (never active/inactive before) aren't eligible for OP
  -- Studio projects — same "has this person ever been an accepted member"
  -- definition as is_returning_member(), kept in sync deliberately.
  if exists (select 1 from public.projects where id = p_project_id and type = 'studio')
     and not exists (
       select 1 from public.members where user_id = v_applicant and status in ('active', 'inactive')
     ) then
    raise exception 'first-time applicants are not eligible for OP Studio projects';
  end if;

  update public.applications
  set status = 'accepted',
      accepted_project_id = p_project_id,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_application_id;

  insert into public.project_members (project_id, user_id, is_pm)
  values (p_project_id, v_applicant, false)
  on conflict (project_id, user_id) do nothing;

  -- Accepting always makes the applicant active, regardless of prior status.
  update public.members
  set status = 'active'
  where user_id = v_applicant;
end;
$$;

grant execute on function public.accept_application(uuid, uuid) to authenticated;

-- 4. set_member_status(): new board/exec-gated RPC backing the admin UI -------

create or replace function public.set_member_status(p_user_id uuid, p_status public.member_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_board_or_exec() then
    raise exception 'not authorized';
  end if;

  update public.members
  set status = p_status
  where user_id = p_user_id;

  if not found then
    raise exception 'member not found';
  end if;
end;
$$;

grant execute on function public.set_member_status(uuid, public.member_status) to authenticated;

-- 5. Defense-in-depth: block self-writes to members.status --------------------

create or replace function public.prevent_self_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and not public.is_board_or_exec() then
    raise exception 'not authorized to change member status';
  end if;
  return new;
end;
$$;

drop trigger if exists members_status_guard on public.members;
create trigger members_status_guard
before update on public.members
for each row
execute function public.prevent_self_status_change();
