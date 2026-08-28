-- Coffee-chat bookings: optional booker message + specific notifications.
--
-- (1) A booker may attach an optional free-text message when booking. It is
--     stored PERMANENTLY on the coffee_chats seat row (not just in a transient
--     notification), so the host can always come back and read it.
--
-- (2) notify_coffee_chat_counterparty is enriched so every notice — and the
--     email that echoes it (0037) — names the other person and states the
--     date/time and location, instead of generic "someone"/"your host" copy.
--     Single source of truth: the in-app bell and the email both inherit the
--     specific title/body composed here.

-- (1) Permanent per-booking message.
alter table public.coffee_chats
  add column if not exists message text;

-- (2a) book_coffee_chat gains an optional p_message. Adding a parameter changes
-- the function's identity, so create-or-replace can't do it in place — drop the
-- 2-arg version first, then recreate with the 3-arg signature (the default keeps
-- existing 2-arg callers, e.g. tests, valid). Body is unchanged except the final
-- UPDATE, which now also stores the trimmed, length-capped message.
drop function if exists public.book_coffee_chat(uuid, timestamptz);

create or replace function public.book_coffee_chat(
  p_member_id    uuid,
  p_meeting_time timestamptz,
  p_message      text default null
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
         location = coalesce(v_location, v_default),
         -- Store the optional booker message (trimmed, capped, blank -> null).
         message = nullif(left(trim(p_message), 500), '')
   where id = v_row_id;

  return v_row_id;
end;
$$;

revoke all on function public.book_coffee_chat(uuid, timestamptz, text) from public, anon;
grant execute on function public.book_coffee_chat(uuid, timestamptz, text) to authenticated;

-- (2b) Enriched cross-user notices. Same signature as 0026, so create-or-replace
-- works in place. Now reads location + message from the seat row and both
-- parties' display names from members, and composes specific title/body copy.
create or replace function public.notify_coffee_chat_counterparty(
  p_chat_id uuid,
  p_type    text,
  p_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member       uuid;
  v_applicant    uuid;
  v_time         timestamptz;
  v_dur          int;
  v_location     text;
  v_msg          text;
  v_recipient    uuid;
  v_host_name    text;
  v_applicant_name text;
  v_default_loc  text;
  v_loc          text;
  v_title        text;
  v_body         text;
  v_when         text;
begin
  select member_id, applicant_id, meeting_time, duration_minutes, location, message
    into v_member, v_applicant, v_time, v_dur, v_location, v_msg
    from public.coffee_chats
   where id = p_chat_id;

  if not found then
    raise exception 'coffee chat % not found', p_chat_id;
  end if;

  -- Authorize and set direction from the row, never from client-supplied ids.
  if auth.uid() = v_member and p_type in ('chat_cancelled_by_host', 'location_added', 'location_updated') then
    v_recipient := v_applicant;
  elsif auth.uid() = v_applicant and p_type in ('chat_booked', 'chat_cancelled_by_applicant') then
    v_recipient := v_member;
  else
    raise exception 'not authorized to notify for this chat, or type mismatch';
  end if;

  if v_recipient is null then
    return; -- open seat: nobody to notify
  end if;

  -- Display names for both parties (mirrors the JS idiom
  -- [preferred_firstname, lastname].filter(Boolean).join(" ")).
  select coalesce(nullif(trim(concat_ws(' ', preferred_firstname, lastname)), ''), 'A member'),
         default_chat_location
    into v_host_name, v_default_loc
    from public.members where user_id = v_member;
  select coalesce(nullif(trim(concat_ws(' ', preferred_firstname, lastname)), ''), 'Someone')
    into v_applicant_name
    from public.members where user_id = v_applicant;

  v_host_name := coalesce(v_host_name, 'A member');
  v_applicant_name := coalesce(v_applicant_name, 'Someone');

  -- Effective location: the seat's own (explicit or frozen-at-booking) value,
  -- else the host's live default.
  v_loc := coalesce(nullif(trim(v_location), ''), nullif(trim(v_default_loc), ''));

  v_when := to_char(v_time, 'Dy Mon FMDD, FMHH12:MI AM');

  if p_type = 'chat_booked' then
    v_title := 'New coffee chat with ' || v_applicant_name;
    v_body  := v_applicant_name || ' booked a ' || v_dur || '-min coffee chat with you on ' || v_when || '.';
    if v_loc is not null then
      v_body := v_body || E'\nLocation: ' || v_loc;
    end if;
    if v_msg is not null and length(trim(v_msg)) > 0 then
      v_body := v_body || E'\nMessage: "' || trim(v_msg) || '"';
    end if;

  elsif p_type = 'chat_cancelled_by_applicant' then
    v_title := v_applicant_name || ' cancelled your coffee chat';
    v_body  := v_applicant_name || ' cancelled the ' || v_dur || '-min coffee chat on ' || v_when
               || '. The slot is open again.';

  elsif p_type = 'chat_cancelled_by_host' then
    v_title := v_host_name || ' cancelled your coffee chat';
    v_body  := v_host_name || ' cancelled your ' || v_dur || '-min coffee chat on ' || v_when || '.';
    -- The host may include an optional reason via p_message.
    if p_message is not null and length(trim(p_message)) > 0 then
      v_body := v_body || E'\nMessage: "' || trim(p_message) || '"';
    end if;

  elsif p_type = 'location_added' then
    v_title := 'Location set for your chat with ' || v_host_name;
    v_body  := v_host_name || ' set the location for your ' || v_dur || '-min coffee chat on ' || v_when
               || coalesce(': ' || v_loc, '') || '.';

  elsif p_type = 'location_updated' then
    v_title := 'Location updated for your chat with ' || v_host_name;
    v_body  := 'Your coffee chat with ' || v_host_name || ' on ' || v_when
               || coalesce(' is now at: ' || v_loc, ' has a new location') || '.';
  end if;

  insert into public.notifications
    (user_id, type, title, body, coffee_chat_id, meeting_time, member_id, actor_id)
  values
    (v_recipient, p_type, v_title, v_body, p_chat_id, v_time, v_member, auth.uid());
end;
$$;

grant execute on function public.notify_coffee_chat_counterparty(uuid, text, text) to authenticated;
