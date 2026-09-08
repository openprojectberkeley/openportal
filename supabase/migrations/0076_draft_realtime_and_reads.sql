-- Live draft updates + the reads the PM/exec draft panel needs.
--
-- 1. draft_round_projects reads: 0072 only let a project's own PM (or a
--    full-access VP) read its draft_round_projects rows. The Applications
--    draft panel now names the project currently on the clock and shows this
--    project's position in the pick order, which means reading the whole
--    round order across projects. Since /manager is board/exec-only
--    (manager/layout.tsx), add a permissive board/exec SELECT policy mirroring
--    the ones draft_rounds/draft_state already have (0072). The existing
--    can_review_project() policy stays (permissive OR).
--
-- 2. Realtime: the panel updates live (no reload) as the turn advances, picks
--    are staged/submitted, and the draft is completed/reset. Add the three
--    draft tables to the supabase_realtime publication and set replica
--    identity full so UPDATE/DELETE change payloads carry the old row for RLS
--    filtering. Idempotent: publication membership has no IF NOT EXISTS, so
--    it's guarded against pg_publication_tables.

-- 1. Board/exec read of the full round order ---------------------------------

drop policy if exists "draft_round_projects_select_board" on public.draft_round_projects;
create policy "draft_round_projects_select_board"
on public.draft_round_projects
for select
to authenticated
using ( public.is_board_or_exec() );

-- 2. Realtime ----------------------------------------------------------------

alter table public.draft_state replica identity full;
alter table public.draft_round_projects replica identity full;
alter table public.draft_picks replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'draft_state'
  ) then
    alter publication supabase_realtime add table public.draft_state;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'draft_round_projects'
  ) then
    alter publication supabase_realtime add table public.draft_round_projects;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'draft_picks'
  ) then
    alter publication supabase_realtime add table public.draft_picks;
  end if;
end $$;
