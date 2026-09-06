-- Keep members.status = 'active' in sync with leadership / project involvement.
--
-- Rule: anyone who is board/exec (a members_roles row whose role has
-- access_level in ('board','exec')), a PM, or a member of ANY project
-- (any project_members row) should have members.status = 'active'.
--
-- This migration (a) backfills existing data and (b) installs triggers that
-- maintain the invariant going forward. Two deliberate limits:
--
--   * It only ever PROMOTES to 'active'. It never demotes -- removing someone
--     from a project / role does NOT flip them back (they may be active for
--     other reasons, and demotion is the admin's explicit call via
--     set_member_status from 0042).
--   * It never touches a 'blacklisted' member -- a blacklist must not be
--     silently undone by adding that person to a project.
--
-- The 0042 members_status_guard (prevent_self_status_change) blocks any status
-- write by a non board/exec caller. These system syncs are authorized by
-- definition, so the guard is extended to also allow a write flagged with the
-- transaction-local GUC app.member_status_sync = 'on', which only these
-- SECURITY DEFINER functions set (a REST/client caller cannot set GUCs).
-- is_board_or_exec() and the existing sanctioned paths (set_member_status,
-- accept_application) are unaffected -- the GUC is an additional allow, not a
-- replacement.

-- 1. Extend the guard to allow flagged system syncs ---------------------------

create or replace function public.prevent_self_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.member_status_sync', true), 'off') <> 'on'
     and not public.is_board_or_exec() then
    raise exception 'not authorized to change member status';
  end if;
  return new;
end;
$$;

-- 2. Helper: activate one member unless already active or blacklisted ----------
-- Not granted to any client role: only the trigger functions below call it.

create or replace function public.sync_activate_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  perform set_config('app.member_status_sync', 'on', true);

  update public.members
  set status = 'active'
  where user_id = p_user_id
    and status not in ('active', 'blacklisted');

  perform set_config('app.member_status_sync', 'off', true);
end;
$$;

-- 3. project_members: any project membership (incl. PMs) activates the member -

create or replace function public.sync_project_member_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_activate_member(new.user_id);
  return new;
end;
$$;

drop trigger if exists project_members_activate on public.project_members;
create trigger project_members_activate
after insert or update of user_id on public.project_members
for each row
execute function public.sync_project_member_status();

-- 4. members_roles: only board/exec roles activate the member -----------------

create or replace function public.sync_member_role_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.roles r
    where r.id = new.role_id and r.access_level in ('board', 'exec')
  ) then
    perform public.sync_activate_member(new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists members_roles_activate on public.members_roles;
create trigger members_roles_activate
after insert or update of user_id, role_id on public.members_roles
for each row
execute function public.sync_member_role_status();

-- 5. roles: promoting a role to board/exec activates all of its holders -------

create or replace function public.sync_role_access_level()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.access_level in ('board', 'exec')
     and old.access_level is distinct from new.access_level then
    perform set_config('app.member_status_sync', 'on', true);

    update public.members m
    set status = 'active'
    where m.status not in ('active', 'blacklisted')
      and m.user_id in (
        select mr.user_id from public.members_roles mr where mr.role_id = new.id
      );

    perform set_config('app.member_status_sync', 'off', true);
  end if;
  return new;
end;
$$;

drop trigger if exists roles_activate on public.roles;
create trigger roles_activate
after update of access_level on public.roles
for each row
execute function public.sync_role_access_level();

-- 6. Backfill existing data (idempotent, safe to re-run) ----------------------

do $$
begin
  perform set_config('app.member_status_sync', 'on', true);

  update public.members m
  set status = 'active'
  where m.status not in ('active', 'blacklisted')
    and m.user_id in (
      select mr.user_id
      from public.members_roles mr
      join public.roles r on r.id = mr.role_id
      where r.access_level in ('board', 'exec')
      union
      select pm.user_id from public.project_members pm
    );

  perform set_config('app.member_status_sync', 'off', true);
end $$;
