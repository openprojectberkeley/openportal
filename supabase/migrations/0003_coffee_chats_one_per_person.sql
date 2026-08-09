-- Optional: enforce "one coffee chat per applicant per member" at the database
-- level, so concurrent double-submits can't both succeed (the app already
-- guards this in the booking flow). Applies only to claimed rows; unclaimed
-- availability slots (applicant_id is null) are unaffected.
--
-- The unique index can't be created while duplicate (member_id, applicant_id)
-- pairs exist, so we clean those up first (freeing the extra slots back to
-- availability rather than deleting them).

-- A member claiming their own slot is invalid — free those.
update public.coffee_chats
set applicant_id = null
where applicant_id = member_id;

-- If an applicant has more than one booking with the same member, keep their
-- earliest and free the rest.
with ranked as (
  select ctid,
         row_number() over (
           partition by member_id, applicant_id
           order by meeting_time
         ) as rn
  from public.coffee_chats
  where applicant_id is not null
)
update public.coffee_chats c
set applicant_id = null
from ranked
where c.ctid = ranked.ctid and ranked.rn > 1;

create unique index if not exists coffee_chats_one_per_person
  on public.coffee_chats (member_id, applicant_id)
  where applicant_id is not null;
