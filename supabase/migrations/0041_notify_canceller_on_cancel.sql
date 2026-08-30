-- Also notify the CANCELLER when they cancel a coffee chat, so the event is
-- removed from BOTH calendars — not just the counterparty's.
--
-- notify_coffee_chat_counterparty notifies only the counterparty. On a cancel,
-- the counterparty gets a `chat_cancelled_*` notice → email → send-notification-
-- email emits a `METHOD:CANCEL` ICS that removes the event from their calendar.
-- The person who clicked cancel got nothing, so their own calendar copy (added
-- by the booking invite in 0040) lingered. This adds a second row addressed to
-- the ACTOR on both cancellation types, with self-facing copy localized to the
-- actor's own timezone.
--
-- Same mechanism as 0040's booker row: the extra row keeps the same
-- `chat_cancelled_*` type, so the 0037 trigger forwards it and the edge function
-- emits a `METHOD:CANCEL` for the same `coffee_chat_id` UID with ATTENDEE = the
-- actor — cancelling the actor's own event.
--
-- Supersedes 0040 (same signature); it recreates the whole function, keeping the
-- 0040 booker-on-book block and adding the canceller-on-cancel block.

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
  v_member        uuid;
  v_applicant     uuid;
  v_time          timestamptz;
  v_dur           int;
  v_location      text;
  v_msg           text;
  v_recipient     uuid;
  v_recipient_tz  text;
  v_applicant_tz  text;
  v_actor_tz      text;
  v_host_name     text;
  v_applicant_name text;
  v_default_loc   text;
  v_loc           text;
  v_title         text;
  v_body          text;
  v_when          text;
  v_when_booker   text;
  v_booker_body   text;
  v_when_actor    text;
  v_other_name    text;
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

  -- Localize to the RECIPIENT's stored timezone; UTC (the prior, wrong-for-
  -- most-people default) only until they've synced one.
  select timezone into v_recipient_tz from public.members where user_id = v_recipient;
  v_when := to_char(v_time AT TIME ZONE coalesce(v_recipient_tz, 'UTC'), 'Dy Mon FMDD, FMHH12:MI AM');

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

  -- On booking, also give the BOOKER a confirmation (in-app + email + ICS invite),
  -- localized to the booker's own timezone rather than the host's.
  if p_type = 'chat_booked' then
    select timezone into v_applicant_tz from public.members where user_id = v_applicant;
    v_when_booker := to_char(v_time AT TIME ZONE coalesce(v_applicant_tz, 'UTC'), 'Dy Mon FMDD, FMHH12:MI AM');

    v_booker_body := 'You booked a ' || v_dur || '-min coffee chat with ' || v_host_name
                     || ' on ' || v_when_booker || '.';
    if v_loc is not null then
      v_booker_body := v_booker_body || E'\nLocation: ' || v_loc;
    end if;
    if v_msg is not null and length(trim(v_msg)) > 0 then
      v_booker_body := v_booker_body || E'\nMessage: "' || trim(v_msg) || '"';
    end if;

    insert into public.notifications
      (user_id, type, title, body, coffee_chat_id, meeting_time, member_id, actor_id)
    values
      (v_applicant, 'chat_booked', 'Coffee chat booked with ' || v_host_name,
       v_booker_body, p_chat_id, v_time, v_member, auth.uid());

  -- On cancellation, also notify the CANCELLER (auth.uid()) so their own calendar
  -- copy is removed via the METHOD:CANCEL invite. Same type keeps it a cancel.
  elsif p_type in ('chat_cancelled_by_applicant', 'chat_cancelled_by_host') then
    v_other_name := case when p_type = 'chat_cancelled_by_applicant' then v_host_name else v_applicant_name end;
    select timezone into v_actor_tz from public.members where user_id = auth.uid();
    v_when_actor := to_char(v_time AT TIME ZONE coalesce(v_actor_tz, 'UTC'), 'Dy Mon FMDD, FMHH12:MI AM');

    insert into public.notifications
      (user_id, type, title, body, coffee_chat_id, meeting_time, member_id, actor_id)
    values
      (auth.uid(), p_type, 'You cancelled your coffee chat with ' || v_other_name,
       'You cancelled the ' || v_dur || '-min coffee chat with ' || v_other_name
         || ' on ' || v_when_actor || '.',
       p_chat_id, v_time, v_member, auth.uid());
  end if;
end;
$$;

grant execute on function public.notify_coffee_chat_counterparty(uuid, text, text) to authenticated;
