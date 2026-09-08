-- Per-project reviewer wishlist: a lightweight shortlist of applicants a
-- project's reviewers want to flag while working the "left to review" queue,
-- separate from actually accepting/rejecting them.
--
-- Scoped to (application_id, project_id) rather than application_id alone
-- since the same applicant can be ranked (and independently wishlisted) by
-- several projects at once. RLS mirrors application_rankings (0057):
-- can_review_project(project_id) covers both full-access reviewers and a
-- project's own PM(s).

create table if not exists public.application_wishlist (
  application_id uuid not null references public.applications(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  primary key (application_id, project_id)
);

alter table public.application_wishlist enable row level security;

drop policy if exists "application_wishlist_select" on public.application_wishlist;
create policy "application_wishlist_select"
on public.application_wishlist
for select
to authenticated
using (public.can_review_project(project_id));

drop policy if exists "application_wishlist_insert" on public.application_wishlist;
create policy "application_wishlist_insert"
on public.application_wishlist
for insert
to authenticated
with check (public.can_review_project(project_id));

drop policy if exists "application_wishlist_delete" on public.application_wishlist;
create policy "application_wishlist_delete"
on public.application_wishlist
for delete
to authenticated
using (public.can_review_project(project_id));
