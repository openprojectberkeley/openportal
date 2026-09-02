-- Unfinished (draft) applications, and how many have any content in a
-- project-specific question answer.
--
-- Schema:
--   applications            -> status = 'draft' means unfinished (not yet submitted)
--   application_rankings     -> one row per project an applicant ranked (FK application_id)
--   application_answers      -> answers to project questions (FK ranking_id, question_id)
--   project_questions        -> the project-specific questions
--
-- "Written at least something" = a non-empty text answer OR a non-empty
-- answer_options selection on any project-specific question.

-- 1) Summary counts
with started_answers as (
  select distinct r.application_id
  from application_answers a
  join application_rankings r on r.id = a.ranking_id
  where coalesce(btrim(a.answer), '') <> ''
     or (a.answer_options is not null
         and a.answer_options <> '[]'::jsonb
         and a.answer_options <> 'null'::jsonb)
)
select
  count(*)                                                          as total_drafts,
  count(*) filter (where sa.application_id is not null)            as drafts_with_answers,
  count(*) filter (where sa.application_id is null)                as drafts_empty
from applications app
left join started_answers sa on sa.application_id = app.id
where app.status = 'draft';

-- 2) Per-application detail: each draft and how many project questions it has
--    started answering (uncomment to inspect individual rows)
-- select
--   app.id as application_id,
--   app.applicant_id,
--   app.created_at,
--   count(a.id) filter (
--     where coalesce(btrim(a.answer), '') <> ''
--        or (a.answer_options is not null
--            and a.answer_options <> '[]'::jsonb
--            and a.answer_options <> 'null'::jsonb)
--   ) as answered_questions
-- from applications app
-- left join application_rankings r on r.application_id = app.id
-- left join application_answers a on a.ranking_id = r.id
-- where app.status = 'draft'
-- group by app.id, app.applicant_id, app.created_at
-- order by answered_questions desc, app.created_at;
