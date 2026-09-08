-- Persisted ordering for the per-project reviewer wishlist (0073).
--
-- The wishlist is now a PM-orderable shortlist (drag-to-reorder on the
-- Applications manager page), so each row needs a stable position within its
-- project. Existing rows are backfilled by created_at so the current, unordered
-- shortlist keeps a deterministic order on first load.
--
-- 0073 only granted select/insert/delete; reordering issues UPDATEs, so a
-- matching update policy is added here (same can_review_project(project_id)
-- gate as the others -- a project's PM(s) plus full-access reviewers).

alter table public.application_wishlist
  add column if not exists position integer not null default 0;

-- Backfill positions per project, oldest first, only for rows still at the
-- default 0 so re-running is a no-op.
with ordered as (
  select
    application_id,
    project_id,
    row_number() over (partition by project_id order by created_at, application_id) - 1 as pos
  from public.application_wishlist
)
update public.application_wishlist w
set position = ordered.pos
from ordered
where w.application_id = ordered.application_id
  and w.project_id = ordered.project_id
  and w.position = 0
  and ordered.pos <> 0;

drop policy if exists "application_wishlist_update" on public.application_wishlist;
create policy "application_wishlist_update"
on public.application_wishlist
for update
to authenticated
using (public.can_review_project(project_id))
with check (public.can_review_project(project_id));
