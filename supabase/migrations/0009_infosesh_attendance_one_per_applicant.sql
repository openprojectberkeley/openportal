-- Enforce "one infosession code per applicant" at the database level.
--
-- Without this, an applicant who claims two codes (e.g. attends/submits for
-- both listed sessions, or retries after a UI glitch) ends up with two rows
-- where applicant_id = them. The home page's completion check reads this
-- with .maybeSingle(), which errors on >1 row — silently reported as "not
-- completed" since the error wasn't checked. See also the app-layer fix in
-- src/app/(app)/page.tsx.
--
-- The unique index can't be created while duplicate applicant_id values
-- exist, so we free the extras back to unclaimed first (keeping each
-- applicant's earliest claim).

with ranked as (
  select ctid,
         row_number() over (
           partition by applicant_id
           order by ctid
         ) as rn
  from public.infosesh_attendance
  where applicant_id is not null
)
update public.infosesh_attendance a
set applicant_id = null
from ranked
where a.ctid = ranked.ctid and ranked.rn > 1;

create unique index if not exists infosesh_attendance_one_per_applicant
  on public.infosesh_attendance (applicant_id)
  where applicant_id is not null;
