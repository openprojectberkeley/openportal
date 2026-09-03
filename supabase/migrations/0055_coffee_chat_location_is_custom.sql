-- Track per-slot location intent explicitly instead of inferring it by value.
--
-- Until now set_default_chat_location (0036) decided which booked chats to rewrite
-- with a value heuristic: rewrite a seat only when its location was NULL or still
-- equalled the OLD default, and treat anything else as a custom per-slot location to
-- preserve. That heuristic silently strands seats whose frozen location drifted from
-- the current default (default cleared, changed before 0036 existed, or changed
-- outside the RPC): they look "custom" forever and never follow the default again —
-- the "changing the default only affects new slots" bug.
--
-- Replace the heuristic with an explicit flag. location_is_custom is true only when a
-- host manually set that slot's location (saveSlotLocation); false means the location
-- is inherited from the host default. A default change re-syncs every non-custom
-- booked seat regardless of its current value.
--
-- book_coffee_chat is intentionally left unchanged: it freezes the default onto a
-- fresh seat (which stays location_is_custom = false and keeps following the default),
-- and preserves a seat that already had a manual location (location_is_custom = true).

alter table public.coffee_chats
  add column if not exists location_is_custom boolean not null default false;

-- Backfill "preserve as manual": any seat whose stored location currently differs
-- from the host's default is kept as a manual override so it keeps its value and is
-- never auto-rewritten. Seats matching the default (or with no location) stay
-- non-custom and will follow future default changes. This preserves what everyone
-- sees today while making the distinction stable going forward.
update public.coffee_chats c
   set location_is_custom = true
  from public.members m
 where m.user_id = c.member_id
   and c.location is not null
   and c.location is distinct from m.default_chat_location;

-- Rewrite the propagation RPC to key off the flag instead of comparing to the old
-- default. Behaviour is otherwise identical to 0036 (freeze/notify/return count).
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
  v_count integer := 0;
  r       record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.members
     set default_chat_location = v_new
   where user_id = v_uid;

  -- Rewrite every upcoming booked seat that is following the default (not a manual
  -- per-slot override), regardless of its current value. Capture the prior value so
  -- we can pick the right notification type.
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
             and location_is_custom = false
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
