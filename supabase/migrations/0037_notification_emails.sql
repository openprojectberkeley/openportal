-- Email delivery for important in-app notifications, via SMTP2GO.
--
-- The app is a static site (no server runtime, no service role in the browser),
-- so email can't originate from the client — it would leak the SMTP2GO key. The
-- `notifications` table is the one chokepoint every notice passes through
-- (self-inserted reminders + the `notify_coffee_chat_counterparty` RPC), so we
-- hook email there:
--
--   AFTER INSERT on notifications
--     -> trigger filters to "important" cross-user types
--     -> pg_net async POST to the `send-notification-email` Edge Function
--          (which reads the row + recipient email with the service role, honors
--           the per-member opt-out, sends via SMTP2GO, then stamps
--           email_sent_at so a retry/replay never double-sends).
--
-- Reminders are intentionally NOT emailed: they only fire when the recipient
-- already has the app open, so an email would be redundant noise.
--
-- Secrets: the Edge Function auth secret and its URL live in Supabase Vault
-- (never committed). See the one-time setup at the bottom of this file — run it
-- once with real values; it is commented out so the migration stays idempotent
-- and secret-free.

-- Async HTTP from Postgres.
create extension if not exists pg_net with schema extensions;

-- Per-member opt-out (default opted-in). Honored by the Edge Function.
alter table public.members
  add column if not exists email_notifications boolean not null default true;

-- Idempotency stamp: set once the email has been handed to SMTP2GO. The Edge
-- Function guards on this being null before sending, so a duplicate webhook
-- delivery or a manual replay never sends twice.
alter table public.notifications
  add column if not exists email_sent_at timestamptz;

-- Fires the Edge Function for the important cross-user notification types only.
-- SECURITY DEFINER so it can read Vault regardless of the inserting role (the
-- RPC runs as the caller; reminders self-insert as the recipient).
create or replace function public.on_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url    text;
  v_secret text;
begin
  -- Only email cross-user coffee-chat events. Reminders never email.
  if new.type not in (
    'chat_booked',
    'chat_cancelled_by_applicant',
    'chat_cancelled_by_host',
    'location_added',
    'location_updated'
  ) then
    return new;
  end if;

  -- Edge Function URL + shared auth secret from Vault. If either is unset
  -- (e.g. a fresh branch DB before setup), skip silently — email is best-effort
  -- and must never block the notification insert.
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'notification_email_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'notification_email_secret';

  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-webhook-secret', v_secret
               ),
    body    := jsonb_build_object('notification_id', new.id),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists trg_notification_email on public.notifications;
create trigger trg_notification_email
  after insert on public.notifications
  for each row
  execute function public.on_notification_email();

-- ---------------------------------------------------------------------------
-- ONE-TIME SETUP (run manually with real values — do NOT commit secrets):
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/send-notification-email',
--     'notification_email_url', 'Edge Function URL for notification emails');
--
--   select vault.create_secret(
--     '<long-random-string>',   -- must equal the Edge Function WEBHOOK_SECRET
--     'notification_email_secret', 'Shared secret authenticating the webhook');
--
-- To rotate later: select vault.update_secret(id, new_value) — look up id via
--   select id, name from vault.secrets where name like 'notification_email_%';
-- ---------------------------------------------------------------------------
