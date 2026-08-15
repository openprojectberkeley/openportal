-- Only exec can change a project's track (OP Studio vs OP Launch).
--
-- 0017 let a project's PMs edit their project. PMs may edit the details, but the
-- Studio/Launch track is an exec decision, so guard the `type` column: a non-exec
-- update that changes `type` is rejected. Other field edits by PMs are unaffected.

create or replace function public.projects_guard_type_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type is distinct from old.type and not public.is_exec() then
    raise exception 'Only exec can change a project''s track (OP Studio / OP Launch).';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_guard_type_change on public.projects;
create trigger projects_guard_type_change
before update on public.projects
for each row execute function public.projects_guard_type_change();
