-- The per-card outcome on the cross-project draft board (?project=all on
-- /manager/applications) now records the APPLICANT'S answer, not ours.
--
-- The flow it models: the draft places people into columns, we email each of
-- them a confirmation, and then they reply. So the three states in
-- set_draft_outcome (0091) read:
--
--   drafted   default -- drafted, confirmation sent, no reply yet.
--   accepted  they took the offer. The only state with an effect: it makes
--             them an official member of the project whose column they sit in
--             (accept_application -> project_members, the 0013 portal roster
--             sync, members.status = 'active').
--   rejected  they turned it down. A label; nothing else happens yet.
--
-- No function here changes for that -- set_draft_outcome's three branches
-- already do exactly this. What has to change is complete_draft, which was
-- written under the old reading.
--
-- complete_draft() used to place every confirmed, still-submitted pick by
-- calling accept_application on it. Under the new reading that is wrong twice
-- over: it would make ~280 people members before a single confirmation went
-- out, and it would green-badge every card on the board so the dropdown could
-- no longer say anything. Finishing the draft is now purely a lock -- it
-- stamps draft_state.completed_at and nothing else -- and membership is
-- created in exactly one place, set_draft_outcome(..., 'accepted'), which by
-- definition runs after the draft is over.
--
-- The loop's `a.status = 'submitted'` filter (0083: skip picks kept for a
-- rejected applicant, leave already-accepted ones alone) goes away with the
-- loop; there is nothing left for it to guard. reset_draft (0074) is
-- unaffected and was already documented as having nothing on
-- applications/project_members to undo -- that is now true of completion too.
-- Signature and authorization are unchanged.

create or replace function public.complete_draft(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_review_all_projects() then
    raise exception 'not authorized';
  end if;

  if not exists (select 1 from public.draft_state where period_id = p_period_id) then
    raise exception 'this draft has not started yet';
  end if;

  if exists (
    select 1 from public.draft_state
    where period_id = p_period_id and completed_at is not null
  ) then
    raise exception 'this draft has already been completed';
  end if;

  -- Lock the draft. Nobody is placed here: each applicant becomes a member of
  -- their column's project only when an exec marks them Accepted on the board,
  -- after they answer their confirmation.
  update public.draft_state
  set completed_at = now()
  where period_id = p_period_id;
end;
$$;

-- Unchanged from 0074/0083, restated the same way 0083 did.
grant execute on function public.complete_draft(uuid) to authenticated;
