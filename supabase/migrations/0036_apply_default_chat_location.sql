-- Propagate the host's default coffee-chat location to existing booked chats.
--
-- Until now, saving the default (members.default_chat_location) only changed the
-- value new/open slots resolve against; already-booked rows kept whatever was
-- frozen onto them by book_coffee_chat (0035) at booking time — including NULL
-- for chats booked while the host had no default, which the applicant's booked-
-- chat view shows as no location at all.
--
-- This RPC sets the default AND rewrites the host's UPCOMING booked chats to the
-- new value, but only where the row has no location yet or still matches the OLD
-- default. A row with a genuine custom per-slot location (differs from the old
-- default) is left untouched. Attendees of changed rows are notified, reusing
-- notify_coffee_chat_counterparty (0026), which authorizes via auth.uid() =
-- member_id — satisfied here because the caller is the host.
--
-- Open (unbooked) rows are intentionally left NULL: they already resolve against
-- the host's live default at display and booking time, so they always reflect
-- the new value without a write.

create or replace function public.set_default_chat_location(
  p_location text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_new   text := nullif(btrim(p_location), '');
  v_old   text;
  v_count integer := 0;
  r       record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Current default becomes the "still following the default" marker for the
  -- rewrite below; read it before we overwrite it.
  select default_chat_location into v_old
    from public.members where user_id = v_uid;

  update public.members
     set default_chat_location = v_new
   where user_id = v_uid;

  -- Rewrite upcoming booked seats that have no location or are still on the old
  -- default; preserve custom per-slot locations. Capture the prior value so we
  -- can pick the right notification type.
  for r in
    with updated as (
      update public.coffee_chats c
         set location = v_new
        from (
          select id, location as old_loc
            from public.coffee_chats
           where member_id = v_uid
             and applicant_id is not null
             and meeting_time >= now()
             and (location is null or location is not distinct from v_old)
             and location is distinct from v_new
        ) src
       where c.id = src.id
       returning c.id, src.old_loc
    )
    select id, old_loc from updated
  loop
    v_count := v_count + 1;
    -- Only notify when a location is actually present now. Clearing the default
    -- (v_new is null) resets non-custom rows silently, matching saveSlotLocation.
    if v_new is not null then
      perform public.notify_coffee_chat_counterparty(
        r.id,
        case when r.old_loc is null then 'location_added' else 'location_updated' end
      );
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.set_default_chat_location(text) from public, anon;
grant execute on function public.set_default_chat_location(text) to authenticated;
