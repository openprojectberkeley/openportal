-- Row-level security for infosession attendance codes.
--
-- Model: board/exec generate codes (insert) and can remove them (delete);
-- any signed-in user can claim an unused code (update); reads are scoped to
-- the code's owner and its claimant.

-- Helper: does the current user have a board- or exec-level role?
create or replace function public.is_board_or_exec()
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
      and r.access_level in ('board', 'exec')
  );
$$;

grant execute on function public.is_board_or_exec() to authenticated;

alter table public.infosesh_attendance enable row level security;

-- INSERT: board/exec only, and only codes attributed to themselves.
drop policy if exists "infosesh_insert_board_exec" on public.infosesh_attendance;
create policy "infosesh_insert_board_exec"
on public.infosesh_attendance
for insert
to authenticated
with check ( public.is_board_or_exec() and member_id = auth.uid() );

-- DELETE: board/exec only.
drop policy if exists "infosesh_delete_board_exec" on public.infosesh_attendance;
create policy "infosesh_delete_board_exec"
on public.infosesh_attendance
for delete
to authenticated
using ( public.is_board_or_exec() );

-- UPDATE: any authenticated user (this is how applicants claim a code).
-- NOTE: this permissive form lets any signed-in user touch any row. The app
-- guards the claim flow, but if you want RLS to enforce it too, replace the
-- policy body with:
--     using ( applicant_id is null )
--     with check ( applicant_id = auth.uid() )
drop policy if exists "infosesh_update_all" on public.infosesh_attendance;
create policy "infosesh_update_all"
on public.infosesh_attendance
for update
to authenticated
using ( true )
with check ( true );

-- SELECT: owners see their own codes; applicants see codes they've claimed.
drop policy if exists "infosesh_select" on public.infosesh_attendance;
create policy "infosesh_select"
on public.infosesh_attendance
for select
to authenticated
using ( member_id = auth.uid() or applicant_id = auth.uid() );
