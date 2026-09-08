-- Draft rounds: the sequential rounds VP Tech/President/VP Projects run to
-- draft accepted applicants onto projects (the /manager/draft page). Each
-- round is scoped to one application period and carries, per participating
-- project, a pick order (who drafts in what order within the round) and a
-- pick count (how many applicants that project may take in that round).
--
-- This migration only lays down the round/order/count structure -- it does
-- not yet touch who actually gets drafted; that's a later addition.

create table if not exists public.draft_rounds (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references public.application_periods(id) on delete cascade,
  round_number int not null check (round_number > 0),
  created_at   timestamptz not null default now(),
  unique (period_id, round_number)
);

alter table public.draft_rounds enable row level security;

drop policy if exists "draft_rounds_all" on public.draft_rounds;
create policy "draft_rounds_all"
on public.draft_rounds
for all
to authenticated
using ( public.can_review_all_projects() )
with check ( public.can_review_all_projects() );

-- One row per project participating in a round: its draft position
-- (pick_order, 1-indexed) and how many applicants it may pick that round
-- (pick_count -- 0 is valid, meaning it sits out). pick_order is deliberately
-- NOT unique per round -- like application_rankings.rank (0021), a bulk
-- reorder persists one row update at a time, and a mid-drag intermediate
-- state can briefly duplicate a position; order ties break on the row's
-- created_at.
create table if not exists public.draft_round_projects (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.draft_rounds(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  pick_order int not null check (pick_order > 0),
  pick_count int not null default 1 check (pick_count >= 0),
  created_at timestamptz not null default now(),
  unique (round_id, project_id)
);

create index if not exists draft_round_projects_round_order_idx on public.draft_round_projects(round_id, pick_order);
create index if not exists draft_round_projects_project_id_idx on public.draft_round_projects(project_id);

alter table public.draft_round_projects enable row level security;

drop policy if exists "draft_round_projects_all" on public.draft_round_projects;
create policy "draft_round_projects_all"
on public.draft_round_projects
for all
to authenticated
using ( public.can_review_all_projects() )
with check ( public.can_review_all_projects() );
