-- Atomic, server-enforced coffee-chat booking.
--
-- Bug: booking rules were enforced only in client JS (a future-only pre-check,
-- window filtering, self-book/one-per-person). The single RLS policy governing
-- a claim, "Applicant can claim an open spot", checked ONLY that the row was
-- open (applicant_id IS NULL -> applicant_id = auth.uid()). So a stale page,
-- a double-click, two tabs, or a crafted request could claim a PAST,
-- OUT-OF-WINDOW, SELF, or DUPLICATE slot. 0030 also dropped the last DB-level
-- uniqueness backstop, leaving concurrent double-submits unguarded.
--
-- Fix: move the whole booking into a SECURITY DEFINER RPC that re-checks every
-- rule and claims a seat atomically, then remove the permissive direct-claim
-- policy so booking can only happen through the RPC.

-- Defense in depth: a host must never occupy their own seat. Clean any existing
-- self-booked rows (as 0003 did once), then enforce it with a CHECK.
update public.coffee_chats set applicant_id = null where applicant_id = member_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coffee_chats_no_self_book'
  ) then
    alter table public.coffee_chats
      add constraint coffee_chats_no_self_book
      check (applicant_id is null or applicant_id <> member_id);
  end if;
end $$;

-- book_coffee_chat: claim one open seat for (p_member_id, p_meeting_time) for
-- the calling user, enforcing every booking rule atomically. Returns the booked
-- coffee_chats.id, or raises one of these messages the client maps to copy:
--   self_book              caller is the host of this slot
--   too_soon               slot is within the 6-hour minimum-notice window
--   past_or_out_of_window  slot is in the past or outside the booking window
--   already_booked         caller already has an upcoming chat with this host
--   slot_taken             no open seat remains at this time
--
-- The 6-hour minimum notice mirrors COFFEE_CHAT_MIN_NOTICE_MS in
-- src/lib/coffee-chat-window.ts; keep the two in sync.
create or replace function public.book_coffee_chat(
  p_member_id    uuid,
  p_meeting_time timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_start     date;
  v_end       date;
  v_default   text;
  v_row_id    uuid;
  v_location  text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- A host can't book their own slot.
  if p_member_id = v_uid then
    raise exception 'self_book';
  end if;

  -- Serialize concurrent bookings for the same (host, applicant) pair so two
  -- in-flight requests can't each pass the one-per-person check below and both
  -- claim a seat. Held until the transaction ends. Postgres can't express a
  -- future-only partial unique index (see 0030), so this is the race backstop.
  perform pg_advisory_xact_lock(hashtext(p_member_id::text), hashtext(v_uid::text));

  -- Must clear the 6-hour minimum-notice window (also excludes past slots).
  if p_meeting_time < now() + interval '6 hours' then
    raise exception 'too_soon';
  end if;

  -- Must fall inside the configured coffee-chat window when one is set. The
  -- stored end date is inclusive, so the exclusive upper bound is end + 1 day —
  -- the same convention as loadCoffeeChatWindowBounds (src/lib/coffee-chat-window.ts).
  select coffee_chat_start, coffee_chat_end into v_start, v_end
    from public.app_settings where id = 1;
  if v_start is not null and p_meeting_time < v_start::timestamptz then
    raise exception 'past_or_out_of_window';
  end if;
  if v_end is not null and p_meeting_time >= (v_end + 1)::timestamptz then
    raise exception 'past_or_out_of_window';
  end if;

  -- At most one UPCOMING chat per (host, applicant). Repeat chats after a past
  -- one are allowed (0030); this only blocks a second future booking.
  if exists (
    select 1 from public.coffee_chats
     where member_id = p_member_id
       and applicant_id = v_uid
       and meeting_time >= now()
  ) then
    raise exception 'already_booked';
  end if;

  -- Claim one still-open seat at this exact time. SKIP LOCKED + FOR UPDATE so
  -- concurrent claims of a multi-seat slot each grab a distinct row.
  select id, location into v_row_id, v_location
    from public.coffee_chats
   where member_id = p_member_id
     and meeting_time = p_meeting_time
     and applicant_id is null
   order by id
   for update skip locked
   limit 1;

  if v_row_id is null then
    raise exception 'slot_taken';
  end if;

  -- Freeze the host's current default location onto the seat if it has none, so
  -- it stays stable even if the host later changes their default. A row with an
  -- explicit per-slot location is left as-is.
  if v_location is null then
    select default_chat_location into v_default from public.members where user_id = p_member_id;
  end if;

  update public.coffee_chats
     set applicant_id = v_uid,
         location = coalesce(v_location, v_default)
   where id = v_row_id;

  return v_row_id;
end;
$$;

revoke all on function public.book_coffee_chat(uuid, timestamptz) from public, anon;
grant execute on function public.book_coffee_chat(uuid, timestamptz) to authenticated;

-- Booking now goes exclusively through the RPC above (SECURITY DEFINER, so it
-- bypasses RLS to claim the seat). Remove the permissive policy that let any
-- client directly claim any open row with no future/window/self/duplicate
-- checks — the source of the reported "booked where they shouldn't" rows.
-- Release (cancel) still works via coffee_chats_applicant_release; host edits
-- via coffee_chats_host_update_own / "Exec/board can manage their slots".
drop policy if exists "Applicant can claim an open spot" on public.coffee_chats;
