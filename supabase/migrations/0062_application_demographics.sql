-- Exec-facing applicant demographics for one application period.
--
-- Backs the grad-year and returning bar charts in the "Recruiting analytics" modal.
-- Returns a long-format table (one row per dimension bucket) so a single RPC
-- covers both breakdowns: dimension in ('grad_year','returning'), bucket = the
-- value (missing/blank grad_year collapsed to 'Unknown'; returning buckets are
-- 'Returning' / 'First-time'), cnt = number of submitted applicants.
--
-- Scoped to submitted applications (status in submitted/accepted/rejected) for the
-- period, joined to members for grad_year/status. Returning = members.status in
-- ('active','inactive'), matching is_returning_member() (0042). grad_year is cast
-- to text defensively. All source columns qualified (sub.*) to avoid the RETURNS
-- TABLE OUT-name ambiguity. SECURITY DEFINER + is_board_or_exec() guard, like the
-- other analytics RPCs (0053/0060/0061).

create or replace function public.application_demographics(p_period_id uuid)
returns table (
  dimension text,
  bucket    text,
  cnt       integer
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
  with sub as (
    select m.grad_year, m.status
    from applications a
    join members m on m.user_id = a.applicant_id
    where a.period_id = p_period_id
      and a.status in ('submitted', 'accepted', 'rejected')
  )
  select 'grad_year'::text, coalesce(nullif(btrim(sub.grad_year::text), ''), 'Unknown'), count(*)::int
  from sub
  group by 1, 2
  union all
  select
    'returning'::text,
    case when sub.status in ('active', 'inactive') then 'Returning' else 'First-time' end,
    count(*)::int
  from sub
  group by 1, 2;
end;
$$;

revoke all on function public.application_demographics(uuid) from public;
grant execute on function public.application_demographics(uuid) to authenticated;
