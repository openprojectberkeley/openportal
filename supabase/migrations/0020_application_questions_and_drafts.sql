-- Per-project application questions (Google-Forms style) + draft applications.
--
--   1. Applications become drafts until submitted (status). The applicant fills
--      each ranked project's questions incrementally and a final submit locks it.
--   2. application_rankings: rank is now mutable during a draft (drop the rank
--      unique), essay is optional until saved, and `completed` tracks per-project
--      progress.
--   3. project_questions: custom questions a project defines (short/long answer,
--      multiple choice, dropdown, checkboxes). application_answers stores the
--      applicant's responses.
--
-- All writes go through the browser Supabase client, so the RLS policies here
-- are the sole write-authorization layer.

-- 1. Draft applications ------------------------------------------------------

alter table public.applications
  add column if not exists status text not null default 'draft';

alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications
  add constraint applications_status_check check (status in ('draft', 'submitted'));

-- Ensure the timestamp columns exist. A pre-existing `applications` table (from
-- the earlier stub) may lack `submitted_at`, which would make the ALTERs below
-- fail. `add column if not exists` is a no-op when 0016 already created them.
alter table public.applications
  add column if not exists submitted_at timestamptz;
alter table public.applications
  add column if not exists created_at timestamptz not null default now();

-- submitted_at is set only on submit now; drafts leave it null.
alter table public.applications alter column submitted_at drop not null;
alter table public.applications alter column submitted_at drop default;

-- Only rows with an actual submit timestamp count as submitted; everything else
-- (drafts, or pre-existing rows with no submitted_at) stays 'draft'. This avoids
-- clobbering in-progress drafts on a table that predates these migrations.
update public.applications set status = 'submitted' where submitted_at is not null;

-- One application per applicant. 0016 declares this inline, but a pre-existing
-- table may not have it; the app's .maybeSingle()/draft logic depends on it.
create unique index if not exists applications_applicant_id_uidx
  on public.applications(applicant_id);

-- 2. application_rankings: draft-friendly ------------------------------------

-- Reordering a draft rewrites rank freely; (application_id, project_id) still
-- prevents duplicate picks.
alter table public.application_rankings
  drop constraint if exists application_rankings_application_id_rank_key;

alter table public.application_rankings alter column essay drop not null;

alter table public.application_rankings
  add column if not exists completed boolean not null default false;
alter table public.application_rankings
  add column if not exists updated_at timestamptz not null default now();

-- 3. project_questions -------------------------------------------------------

create table if not exists public.project_questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  position int not null default 0,
  type text not null,
  prompt text not null,
  options jsonb,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_questions drop constraint if exists project_questions_type_check;
alter table public.project_questions
  add constraint project_questions_type_check
  check (type in ('short_answer', 'long_answer', 'multiple_choice', 'dropdown', 'checkboxes'));

create index if not exists project_questions_project_id_idx
  on public.project_questions(project_id);

alter table public.project_questions enable row level security;

-- Anyone signed in can read questions (applicants render them).
drop policy if exists "project_questions_select" on public.project_questions;
create policy "project_questions_select"
on public.project_questions
for select
to authenticated
using ( true );

-- Exec or the project's PMs manage questions (mirrors projects UPDATE, 0017).
drop policy if exists "project_questions_insert" on public.project_questions;
create policy "project_questions_insert"
on public.project_questions
for insert
to authenticated
with check (
  public.is_exec()
  or exists (
    select 1 from public.project_members pm
    where pm.project_id = project_questions.project_id
      and pm.user_id = auth.uid()
      and pm.is_pm
  )
);

drop policy if exists "project_questions_update" on public.project_questions;
create policy "project_questions_update"
on public.project_questions
for update
to authenticated
using (
  public.is_exec()
  or exists (
    select 1 from public.project_members pm
    where pm.project_id = project_questions.project_id
      and pm.user_id = auth.uid()
      and pm.is_pm
  )
)
with check (
  public.is_exec()
  or exists (
    select 1 from public.project_members pm
    where pm.project_id = project_questions.project_id
      and pm.user_id = auth.uid()
      and pm.is_pm
  )
);

drop policy if exists "project_questions_delete" on public.project_questions;
create policy "project_questions_delete"
on public.project_questions
for delete
to authenticated
using (
  public.is_exec()
  or exists (
    select 1 from public.project_members pm
    where pm.project_id = project_questions.project_id
      and pm.user_id = auth.uid()
      and pm.is_pm
  )
);

-- 4. application_answers -----------------------------------------------------

create table if not exists public.application_answers (
  id uuid primary key default gen_random_uuid(),
  ranking_id uuid not null references public.application_rankings(id) on delete cascade,
  question_id uuid not null references public.project_questions(id) on delete cascade,
  answer text,
  answer_options jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ranking_id, question_id)
);

create index if not exists application_answers_ranking_id_idx
  on public.application_answers(ranking_id);

alter table public.application_answers enable row level security;

-- Ownership derives from the answer's ranking -> application -> applicant.
-- board/exec may read all.
drop policy if exists "application_answers_select" on public.application_answers;
create policy "application_answers_select"
on public.application_answers
for select
to authenticated
using (
  public.is_board_or_exec()
  or exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
);

drop policy if exists "application_answers_insert" on public.application_answers;
create policy "application_answers_insert"
on public.application_answers
for insert
to authenticated
with check (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
);

drop policy if exists "application_answers_update" on public.application_answers;
create policy "application_answers_update"
on public.application_answers
for update
to authenticated
using (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
);

drop policy if exists "application_answers_delete" on public.application_answers;
create policy "application_answers_delete"
on public.application_answers
for delete
to authenticated
using (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
);
