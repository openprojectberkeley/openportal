-- Localize cross-user coffee-chat notifications to the RECIPIENT's timezone.
--
-- notify_coffee_chat_counterparty (0026, enriched in 0038) formats the meeting
-- time with `to_char(v_time, ...)`, which implicitly converts the timestamptz
-- using the Postgres session's default timezone (UTC on Supabase) — not the
-- recipient's. The in-app pages and emails that render `meeting_time` in the
-- BROWSER already convert correctly via `.toLocaleTimeString()`, so this only
-- ever showed up in notification title/body text, which is composed once,
-- server-side, and stored as plain text (no client-side re-formatting).
--
-- Fix: add an opt-in `members.timezone` (IANA name, e.g. "America/Los_Angeles"),
-- have the client keep it in sync with the browser's detected zone, and have
-- notify_coffee_chat_counterparty localize to the RECIPIENT's stored zone
-- (falling back to UTC, the prior behavior, if they haven't synced one yet).

alter table public.members
  add column if not exists timezone text;

-- Client-side sync point: called once per session with the browser's detected
-- IANA zone (Intl.DateTimeFormat().resolvedOptions().timeZone). Validated
-- against pg_timezone_names and a no-op when already current, so it's cheap
-- to call opportunistically without a read-then-write race.
create or replace function public.set_member_timezone(
  p_timezone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tz  text := nullif(btrim(p_timezone), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Silently ignore anything that isn't a real IANA zone name rather than
  -- erroring the caller's fire-and-forget sync.
  if v_tz is not null and not exists (
    select 1 from pg_timezone_names where name = v_tz
  ) then
    return;
  end if;

  update public.members
     set timezone = v_tz
   where user_id = v_uid
     and timezone is distinct from v_tz;
end;
$$;

revoke all on function public.set_member_timezone(text) from public, anon;
grant execute on function public.set_member_timezone(text) to authenticated;

-- Same signature as 0038, so create-or-replace works in place. Only change:
-- v_when is now computed against the RECIPIENT's stored timezone instead of
-- the session default.
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
  v_recipient_tz text;
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
end;
$$;

grant execute on function public.notify_coffee_chat_counterparty(uuid, text, text) to authenticated;
