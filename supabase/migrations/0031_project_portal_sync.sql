-- Make project portals a pure projection of their project.
--
-- Before this, a project portal (portals.type='project') carried its own
-- name/description/icon/color, typed in independently, and PMs (or exec) created
-- portals by hand. This migration:
--   * adds icon/icon_url/color to projects (so the project owns all the
--     project-derived presentation, mirroring the portal columns),
--   * gives projects their own Storage bucket for uploaded icons,
--   * auto-creates the project portal when a project is created,
--   * syncs name/description/icon/icon_url/color project -> portal on every
--     project edit, and LOCKS those five fields on the portal (portal-side edits
--     are reverted to the project's values), and
--   * restricts portal creation to exec (PMs can no longer create any portal).
-- Finally it backfills: seeds project icon/color from existing project portals
-- (so nothing is lost), creates portals for projects that lack one, and
-- reconciles every project portal to its project.

-- 1. Project presentation columns (mirror portals.icon/icon_url/color). -------
alter table public.projects add column if not exists icon text;
alter table public.projects add column if not exists icon_url text;
alter table public.projects add column if not exists color text;

-- 2. can_edit_project(): exec, or a PM of the project. Matches the projects
--    UPDATE policy from 0017; used to gate project-icon Storage writes. --------
create or replace function public.can_edit_project(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_exec()
    or exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id
        and pm.user_id = auth.uid()
        and pm.is_pm
    );
$$;

grant execute on function public.can_edit_project(uuid) to authenticated;

-- 3. `projects` Storage bucket for uploaded icons — mirrors 0015's `portals`
--    bucket. Public read; writes gated by can_edit_project() on the object's
--    first path segment (`{project_id}/icon.jpg`). ----------------------------
insert into storage.buckets (id, name, public)
values ('projects', 'projects', true)
on conflict (id) do update set public = true;

drop policy if exists "projects_icon_read" on storage.objects;
create policy "projects_icon_read"
on storage.objects
for select
to public
using ( bucket_id = 'projects' );

drop policy if exists "projects_icon_insert" on storage.objects;
create policy "projects_icon_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'projects'
  and public.can_edit_project(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "projects_icon_update" on storage.objects;
create policy "projects_icon_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'projects'
  and public.can_edit_project(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'projects'
  and public.can_edit_project(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "projects_icon_delete" on storage.objects;
create policy "projects_icon_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'projects'
  and public.can_edit_project(((storage.foldername(name))[1])::uuid)
);

-- 4. Auto-create the project portal on project insert. -----------------------
-- SECURITY DEFINER so it bypasses the (now exec-only) portals INSERT policy.
-- The existing portal AFTER-INSERT triggers then fire: populate_project_portal
-- (0013, seeds roster) and portals_grant_creator_admin (0014, owner row). The
-- portals_one_per_project_idx unique index (0012) guards against duplicates.
create or replace function public.create_project_portal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.portals (name, description, icon, icon_url, color, type, project_id)
  values (new.name, new.description, new.icon, new.icon_url, new.color, 'project', new.id);
  return new;
end;
$$;

drop trigger if exists create_project_portal on public.projects;
create trigger create_project_portal
after insert on public.projects
for each row execute function public.create_project_portal();

-- 5. Sync the projected fields project -> portal on project edit. -------------
create or replace function public.sync_project_to_portal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name        is distinct from old.name
     or new.description is distinct from old.description
     or new.icon        is distinct from old.icon
     or new.icon_url    is distinct from old.icon_url
     or new.color       is distinct from old.color then
    update public.portals
    set name        = new.name,
        description = new.description,
        icon        = new.icon,
        icon_url    = new.icon_url,
        color       = new.color,
        updated_at  = now()
    where project_id = new.id
      and type = 'project';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_project_to_portal on public.projects;
create trigger sync_project_to_portal
after update on public.projects
for each row execute function public.sync_project_to_portal();

-- 6. Lock the projected fields on project portals. ----------------------------
-- BEFORE UPDATE on portals: for type='project', overwrite the five projected
-- fields with the linked project's current values, making any portal-side edit
-- of them a no-op. Idempotent with the sync path (which writes those same
-- values). Other columns (roles live elsewhere) are untouched.
create or replace function public.lock_project_portal_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  proj public.projects%rowtype;
begin
  if new.type = 'project' and new.project_id is not null then
    select * into proj from public.projects where id = new.project_id;
    if found then
      new.name        := proj.name;
      new.description := proj.description;
      new.icon        := proj.icon;
      new.icon_url    := proj.icon_url;
      new.color       := proj.color;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lock_project_portal_fields on public.portals;
create trigger lock_project_portal_fields
before update on public.portals
for each row execute function public.lock_project_portal_fields();

-- 7. Portal creation is exec-only (drops 0012's PM branch; project portals are
--    created by the trigger above, never by hand). -----------------------------
drop policy if exists "portals_insert" on public.portals;
create policy "portals_insert"
on public.portals
for insert
to authenticated
with check ( public.is_exec() );

-- 8. Backfill. ----------------------------------------------------------------
-- a. Seed project icon/color from existing project portals so current visuals
--    aren't lost when the portal starts deriving from the project.
update public.projects p
set icon     = coalesce(p.icon, po.icon),
    icon_url = coalesce(p.icon_url, po.icon_url),
    color    = coalesce(p.color, po.color)
from public.portals po
where po.project_id = p.id
  and po.type = 'project'
  and (p.icon is null or p.icon_url is null or p.color is null);

-- b. Create a project portal for every project that lacks one (populate/owner
--    triggers fire per row; owner row is skipped when auth.uid() is null).
insert into public.portals (name, description, icon, icon_url, color, type, project_id)
select p.name, p.description, p.icon, p.icon_url, p.color, 'project', p.id
from public.projects p
where not exists (
  select 1 from public.portals po where po.project_id = p.id
);

-- c. Reconcile every project portal to its project (the lock trigger also
--    re-derives these on the update, so they end up identical).
update public.portals po
set name        = p.name,
    description = p.description,
    icon        = p.icon,
    icon_url    = p.icon_url,
    color       = p.color,
    updated_at  = now()
from public.projects p
where po.project_id = p.id
  and po.type = 'project';
