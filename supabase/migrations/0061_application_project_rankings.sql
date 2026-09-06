-- Exec-facing global project-ranking distribution for one application period.
--
-- Backs the "Project analytics" modal on the Applications manager page: across
-- every project, how many submitted applicants ranked it 1st, 2nd, 3rd, … So the
-- client can build a project × rank matrix ("how many 1st picks chose each
-- project", etc.). One row per (project, rank) with a non-zero count.
--
-- Scoped to submitted applications (status in submitted/accepted/rejected) and
-- current rankings only (ranked = true — an un-ranked/removed choice isn't a pick).
-- Every column is qualified: the RETURNS TABLE OUT names (project_id, rank, …)
-- are in scope in the body, so bare references would be ambiguous.
--
-- SECURITY DEFINER + is_board_or_exec() guard, mirroring application_analytics
-- (0060) / application_period_stats (0053). Board/exec already read every ranking
-- via the applications/application_rankings SELECT RLS; the exec-only visibility
-- is a UI concern enforced on the client.

create or replace function public.application_project_rankings(p_period_id uuid)
returns table (
  project_id   uuid,
  project_name text,
  project_type text,
  rank         integer,
  cnt          integer
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
  select
    r.project_id,
    pr.name,
    pr.type,
    r.rank::int,  -- application_rankings.rank is smallint; the OUT column is integer
    count(*)::int
  from application_rankings r
  join applications a on a.id = r.application_id
  join projects pr on pr.id = r.project_id
  where a.period_id = p_period_id
    and a.status in ('submitted', 'accepted', 'rejected')
    and r.ranked
  group by r.project_id, pr.name, pr.type, r.rank
  order by pr.name, r.rank;
end;
$$;

revoke all on function public.application_project_rankings(uuid) from public;
grant execute on function public.application_project_rankings(uuid) to authenticated;
