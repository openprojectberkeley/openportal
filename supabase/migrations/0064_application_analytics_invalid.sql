-- Per-person "invalid" list for the recruiting analytics Valid card.
--
-- Returns one row per submitted applicant in a period who is not both-valid,
-- using the same predicates as 0063's `both_valid`:
--   coffee valid = completed a coffee chat OR returning member
--   info valid   = attended an info session
--   invalid      = submitted set AND NOT (coffee valid AND info valid)
--
-- A booked-but-incomplete chat does not count, and returning exempts only the
-- coffee chat. Flags are raw so the modal can label issues:
--   not coffee-valid + has_chat → "Coffee booked (incomplete)"
--   not coffee-valid + no chat  → "No coffee chat"
--   not info-valid              → "No info session"
--
-- SECURITY DEFINER + is_board_or_exec() — client-side applications SELECT is
-- project-scoped after 0057, so an exec who isn't a full-access reviewer would
-- otherwise get an incomplete list. All source columns qualified to avoid the
-- RETURNS TABLE OUT-name ambiguity.

create or replace function public.application_analytics_invalid(p_period_id uuid)
returns table (
  applicant_id        uuid,
  preferred_firstname text,
  lastname            text,
  is_returning        boolean,
  did_complete        boolean,
  has_chat            boolean,
  did_att             boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_board_or_exec() then
    raise exception 'not authorized';
  end if;

  return query
  with flagged as (
    select
      a.applicant_id as aid,
      m.preferred_firstname as fname,
      m.lastname as lname,
      exists (
        select 1 from members r
        where r.user_id = a.applicant_id and r.status in ('active', 'inactive')
      ) as ret,
      exists (
        select 1 from coffee_chats c
        where c.applicant_id = a.applicant_id and c.complete
      ) as completed,
      exists (
        select 1 from coffee_chats c
        where c.applicant_id = a.applicant_id
      ) as booked,
      exists (
        select 1 from infosesh_attendance i
        where i.applicant_id = a.applicant_id or i.member_id = a.applicant_id
      ) as attended
    from applications a
    left join members m on m.user_id = a.applicant_id
    where a.period_id = p_period_id
      and a.status in ('submitted', 'accepted', 'rejected')
  )
  select
    flagged.aid,
    flagged.fname,
    flagged.lname,
    flagged.ret,
    flagged.completed,
    flagged.booked,
    flagged.attended
  from flagged
  where not ((flagged.completed or flagged.ret) and flagged.attended)
  order by
    coalesce(flagged.fname, ''),
    coalesce(flagged.lname, ''),
    flagged.aid;
end;
$$;

revoke all on function public.application_analytics_invalid(uuid) from public;
grant execute on function public.application_analytics_invalid(uuid) to authenticated;
