-- Coffee-chat no-show state.
--
-- A booked coffee chat (applicant_id is not null) records only `complete`
-- today, so a chat the host confirms *didn't* happen has nowhere to persist and
-- would keep showing up as "unconfirmed" forever. Add a `no_show` flag so the
-- host can settle every past chat: pending (complete=false, no_show=false),
-- completed (complete=true), or no-show (no_show=true). The UI keeps `complete`
-- and `no_show` mutually exclusive. The applicant "Coffee Chat" checklist step
-- keys off complete=true, so a no-show correctly doesn't count as done.
--
-- No RLS change needed: coffee_chats_host_update_own (0028) already lets a host
-- update any column on rows where member_id = auth.uid().
alter table public.coffee_chats
  add column if not exists no_show boolean not null default false;
