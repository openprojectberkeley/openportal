-- 0108: the PM role follows project PM status, for current projects only.
--
-- Before: the "PM" role (roles.access_level = 'board') was a hand-maintained
-- label, so it drifted from project_members.is_pm in both directions, and a
-- stale PM role kept board access after someone stopped being a PM.
--
-- After:
--   * projects belong to a semester (projects.semester_id). A project is
--     CURRENT when its semester is the active one (0103's active_semester_id()).
--     Until any semester is active, projects with no semester count as current,
--     so nothing breaks on a fresh database.
--   * someone holds the PM role exactly when they are a PM (project_members.is_pm)
--     of at least one current project. Triggers keep members_roles in sync as
--     PMs, projects' semesters, and the active semester change.
--   * is_pm() (and so is_board_or_exec(), board = exec + PMs) only counts
--     current projects. Someone with a PM role but no current PM project loses
--     board access unless another role gives it to them. Execs can be PMs too:
--     they simply hold both roles.
--   * the PM role can't be granted by hand any more; only the sync writes it
--     (a manual removal is undone by the next sync).
--
-- Idempotent: safe to run more than once. Run in the Supabase SQL editor.

-- 1. Projects belong to a semester ------------------------------------------------

alter table public.projects
  add column if not exists semester_id uuid references public.semesters(id) on delete set null;

create index if not exists projects_semester_id_idx on public.projects (semester_id);

-- Existing projects are this semester's projects (if a semester is active).
update public.projects
set semester_id = public.active_semester_id()
where semester_id is null
  and public.active_semester_id() is not null;

-- New projects default to the active semester when none is given.
create or replace function public.default_project_semester()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.semester_id is null then
    new.semester_id := public.active_semester_id();
  end if;
  return new;
end;
$$;

drop trigger if exists projects_default_semester on public.projects;
create trigger projects_default_semester
before insert on public.projects
for each row execute function public.default_project_semester();

-- 2. "Current project" -----------------------------------------------------------

create or replace function public.is_current_project(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- `is not distinct from`: with no active semester, unassigned projects
  -- (null = null) count as current; once one is active, only its projects do.
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and p.semester_id is not distinct from public.active_semester_id()
  );
$$;

grant execute on function public.is_current_project(uuid) to authenticated;

-- is_pm(): a PM of any CURRENT project. Feeds is_board_or_exec() (0016).
create or replace function public.is_pm()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
    where pm.user_id = (select auth.uid())
      and pm.is_pm
      and p.semester_id is not distinct from public.active_semester_id()
  );
$$;

grant execute on function public.is_pm() to authenticated;

-- 3. The sync ---------------------------------------------------------------------

-- roles.id / members_roles.role_id are smallint.
create or replace function public.pm_role_id()
returns smallint
language sql
security definer
set search_path = public
stable
as $$
  select id from public.roles where lower(role_name) = 'pm' order by id limit 1;
$$;

-- Grant or remove the PM role for one person so it matches their current PM
-- status. The only writer of PM role rows (see the guard in section 4).
create or replace function public.sync_pm_role(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role smallint := public.pm_role_id();
  v_should boolean;
begin
  if v_role is null or p_user_id is null then
    return;
  end if;

  select exists (
    select 1
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
    where pm.user_id = p_user_id
      and pm.is_pm
      and p.semester_id is not distinct from public.active_semester_id()
  ) into v_should;

  perform set_config('app.pm_role_sync', 'on', true);
  if v_should then
    insert into public.members_roles (user_id, role_id)
    select p_user_id, v_role
    where not exists (
      select 1 from public.members_roles where user_id = p_user_id and role_id = v_role
    );
  else
    delete from public.members_roles where user_id = p_user_id and role_id = v_role;
  end if;
  perform set_config('app.pm_role_sync', 'off', true);
end;
$$;

-- Everyone who holds the role or is a PM anywhere: run after the active
-- semester changes, and once below as the backfill.
create or replace function public.sync_all_pm_roles()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role smallint := public.pm_role_id();
  r record;
begin
  for r in
    select user_id from public.project_members where is_pm
    union
    select user_id from public.members_roles where role_id = v_role
  loop
    perform public.sync_pm_role(r.user_id);
  end loop;
end;
$$;

revoke execute on function public.sync_pm_role(uuid) from public, anon, authenticated;
revoke execute on function public.sync_all_pm_roles() from public, anon, authenticated;

-- project_members: a PM added, removed, promoted or demoted.
create or replace function public.project_members_sync_pm_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.sync_pm_role(old.user_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    perform public.sync_pm_role(new.user_id);
  end if;
  return null;
end;
$$;

drop trigger if exists project_members_sync_pm_role on public.project_members;
create trigger project_members_sync_pm_role
after insert or delete or update of is_pm, user_id, project_id on public.project_members
for each row execute function public.project_members_sync_pm_role();

-- projects: moved to another semester (deletes cascade through project_members).
create or replace function public.projects_sync_pm_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.semester_id is distinct from old.semester_id then
    for r in select user_id from public.project_members where project_id = new.id and is_pm loop
      perform public.sync_pm_role(r.user_id);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists projects_sync_pm_roles on public.projects;
create trigger projects_sync_pm_roles
after update of semester_id on public.projects
for each row execute function public.projects_sync_pm_roles();

-- semesters: a different semester became active (or none is).
create or replace function public.semesters_sync_pm_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_all_pm_roles();
  return null;
end;
$$;

drop trigger if exists semesters_sync_pm_roles on public.semesters;
create trigger semesters_sync_pm_roles
after insert or delete or update of is_active on public.semesters
for each statement execute function public.semesters_sync_pm_roles();

-- 4. Nobody edits the PM role by hand ---------------------------------------------

create or replace function public.members_roles_guard_pm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role smallint := public.pm_role_id();
begin
  if coalesce(current_setting('app.pm_role_sync', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  -- Granting (or re-pointing a row to/from) the PM role by hand is refused.
  -- Deletes pass: a user's role rows are removed when their account is, and a
  -- stray manual removal is put back by the next sync.
  if tg_op = 'INSERT' and new.role_id = v_role then
    raise exception 'The PM role is set automatically from project PMs.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.role_id = v_role or old.role_id = v_role) and new.role_id is distinct from old.role_id then
    raise exception 'The PM role is set automatically from project PMs.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists members_roles_guard_pm on public.members_roles;
create trigger members_roles_guard_pm
before insert or update on public.members_roles
for each row execute function public.members_roles_guard_pm();

-- 5. Backfill ---------------------------------------------------------------------
-- Adds the role to current PMs who lack it and removes it from everyone else.

select public.sync_all_pm_roles();

notify pgrst, 'reload schema';

-- Rollback ------------------------------------------------------------------------
--   drop trigger if exists members_roles_guard_pm on public.members_roles;
--   drop trigger if exists semesters_sync_pm_roles on public.semesters;
--   drop trigger if exists projects_sync_pm_roles on public.projects;
--   drop trigger if exists project_members_sync_pm_role on public.project_members;
--   drop trigger if exists projects_default_semester on public.projects;
--   restore is_pm() from 0012 (any project, not just current);
--   alter table public.projects drop column if exists semester_id;
-- Removed PM role rows are not restored; re-grant by hand if needed.
