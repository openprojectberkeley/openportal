-- Tracks where a period's draft currently is, so "Start Draft" and stepping
-- forward/backward through picks (/manager/draft) survives a page refresh
-- and is shared by whoever's running it.
--
-- One row per period. No row (or a null current_pick_id) means the draft
-- hasn't started; current_pick_id points at the draft_round_projects row
-- whose turn it currently is, within the flattened sequence of rounds
-- (ordered by round_number) x projects-with-pick_count>0 (ordered by
-- pick_order). That flattening is computed client-side from draft_rounds/
-- draft_round_projects (0070) -- this table only remembers the pointer.
create table if not exists public.draft_state (
  period_id       uuid primary key references public.application_periods(id) on delete cascade,
  current_pick_id uuid references public.draft_round_projects(id) on delete set null,
  updated_at      timestamptz not null default now()
);

alter table public.draft_state enable row level security;

drop policy if exists "draft_state_all" on public.draft_state;
create policy "draft_state_all"
on public.draft_state
for all
to authenticated
using ( public.can_review_all_projects() )
with check ( public.can_review_all_projects() );
