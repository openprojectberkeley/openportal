-- Preserve a project's application data (essay + answers) when it's removed from
-- the ranking and later re-added.
--
-- Previously removing a project deleted its application_rankings row, which
-- cascaded away its essay and answers. Instead we soft-remove: the row (and its
-- answers) is kept with ranked = false, so re-adding the project restores it.
-- Only ranked = true rows make up the applicant's current ranking.

alter table public.application_rankings
  add column if not exists ranked boolean not null default true;

create index if not exists application_rankings_application_ranked_idx
  on public.application_rankings(application_id, ranked);
