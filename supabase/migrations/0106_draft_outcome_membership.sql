-- The cross-project draft board (?project=all on /manager/applications) now
-- reads each card's outcome from MEMBERSHIP -- a project_members row for the
-- column's project -- rather than from applications.status +
-- accepted_project_id. This migration is the write side of that change.
--
-- Why the board moved: the two could disagree, and when they did the
-- application won the display while membership was what actually mattered.
-- Removing someone from a project portal's member list (portal-members-modal,
-- allowed by project_members_delete_exec / 0101) deletes the project_members
-- row and, via the 0013 sync trigger, the managed portal_members row with it --
-- but it does not touch their application. The card stayed green and
-- "Accepted" while the person had no project, no project portal and no
-- project-coloured banner anywhere in the app. Five people in the Fall 2026
-- cycle were sitting in exactly that state. Membership is the state with
-- consequences, so membership is what the chip should report.
--
-- What that breaks without this change: the menu could no longer take back
-- what the chip was showing. set_draft_outcome's existing delete is keyed on
-- v_accepted -- the project the APPLICATION records -- so a membership row the
-- application doesn't know about (a hand-added roster entry, or one re-created
-- by hand to repair the divergence above) survives every outcome. The chip
-- would read "Accepted" from that row, "Drafted" would run, succeed, write
-- nothing the chip reads, and the chip would come back Accepted. A control
-- that does nothing is worse than the bug it was meant to fix.
--
-- So: on any outcome that is not an acceptance of THIS column, also clear this
-- column's own membership. Two deletes rather than one widened delete, because
-- they answer different questions -- "where does the application say they were
-- placed" and "is there a row under this column" -- and in the ordinary case
-- (accept, then correct it on the same card) they name the same project and
-- the second is a no-op.
--
-- `and not is_pm` is carried over from the original delete and matters more
-- now: a PM of the project is a project_members row too, so it must survive
-- an outcome click on their card. The board reads non-PM membership for the
-- same reason -- a PM's row is not an acceptance.
--
-- Everything else is unchanged from 0092/0091: the authorization gate, the
-- outcome vocabulary, accept_application for the accept branch, and keeping
-- the draft_pick on a rejection so the card stays on the board.

create or replace function public.set_draft_outcome(p_application_id uuid, p_project_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applicant uuid;
  v_accepted  uuid;
begin
  if not public.can_review_all_projects() then
    raise exception 'not authorized';
  end if;

  if p_outcome is null or p_outcome not in ('drafted', 'accepted', 'rejected') then
    raise exception 'unknown outcome';
  end if;

  select a.applicant_id, a.accepted_project_id
    into v_applicant, v_accepted
  from public.applications a
  where a.id = p_application_id;

  if v_applicant is null then
    raise exception 'application not found';
  end if;

  -- Where the application says they were placed, when this outcome is no
  -- longer that placement.
  if v_accepted is not null
     and (p_outcome <> 'accepted' or v_accepted is distinct from p_project_id) then
    delete from public.project_members
    where project_id = v_accepted
      and user_id    = v_applicant
      and not is_pm;
  end if;

  -- This column's own membership, which the application may never have
  -- recorded. Only on a non-accept: accepting is what creates it.
  if p_outcome <> 'accepted' and p_project_id is not null then
    delete from public.project_members
    where project_id = p_project_id
      and user_id    = v_applicant
      and not is_pm;
  end if;

  if p_outcome = 'accepted' then
    if p_project_id is null then
      raise exception 'a project is required to accept an applicant';
    end if;
    perform public.accept_application(p_application_id, p_project_id);

  elsif p_outcome = 'rejected' then
    -- NOT reject_application() (0083), which also deletes every draft_pick.
    update public.applications
    set status              = 'rejected',
        accepted_project_id = null,
        reviewed_by         = auth.uid(),
        reviewed_at         = now()
    where id = p_application_id;

  else
    update public.applications
    set status              = 'submitted',
        accepted_project_id = null,
        reviewed_by         = null,
        reviewed_at         = null
    where id = p_application_id;
  end if;
end;
$$;

-- Unchanged from 0091/0092, restated the same way they did.
grant execute on function public.set_draft_outcome(uuid, uuid, text) to authenticated;

-- accept_application's project_members insert is `on conflict do nothing`
-- (0022). That is still right -- re-accepting someone already on the project
-- must not error -- but it means the 0013 portal sync trigger never fires when
-- the project_members row happens to exist while the managed portal_members row
-- does not. The board's own repair path (accept again) could therefore leave
-- the portal row missing, which is one of the two halves of what people
-- actually saw. Reconcile any such pair here, and do it set-based so it also
-- cleans up rows that diverged before this migration.
-- Mirrors sync_project_members_to_portals()'s insert branch exactly: project
-- portals only, is_admin tracking the project's PM flag, managed = true.
insert into public.portal_members (portal_id, user_id, is_admin, managed)
select pt.id, pm.user_id, pm.is_pm, true
from public.project_members pm
join public.portals pt
  on pt.project_id = pm.project_id
 and pt.type = 'project'
on conflict (portal_id, user_id) do nothing;
