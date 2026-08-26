-- Audit trail for applicant coffee-chat cancellations.
--
-- Rescheduling is done by cancel + manual re-book, so cancellations are rate
-- limited (at most 5 per rolling 24h per applicant) to prevent slot churn.
-- Once a booking is released its applicant_id is null, leaving no record of who
-- cancelled it, so we log each cancellation here. The client counts recent rows
-- before allowing another cancel; an optional BEFORE trigger (below, commented)
-- can enforce it in the database as defense-in-depth.
create table if not exists public.coffee_chat_cancellations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  coffee_chat_id uuid,
  member_id      uuid,
  meeting_time   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists coffee_chat_cancellations_user_time
  on public.coffee_chat_cancellations (user_id, created_at desc);

alter table public.coffee_chat_cancellations enable row level security;

drop policy if exists "cxl_insert_own" on public.coffee_chat_cancellations;
create policy "cxl_insert_own"
on public.coffee_chat_cancellations
for insert to authenticated
with check ( user_id = auth.uid() );

drop policy if exists "cxl_select_own" on public.coffee_chat_cancellations;
create policy "cxl_select_own"
on public.coffee_chat_cancellations
for select to authenticated
using ( user_id = auth.uid() );

-- Optional hard enforcement (defense-in-depth; advisory client check is the
-- primary UX). Uncomment to reject an applicant's 6th release within 24h and
-- log the cancellation atomically:
--
-- create or replace function public.enforce_coffee_chat_cancel_limit()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   if old.applicant_id = auth.uid() and new.applicant_id is null then
--     if (select count(*) from public.coffee_chat_cancellations
--          where user_id = auth.uid() and created_at > now() - interval '24 hours') >= 5 then
--       raise exception 'cancellation limit reached (5 per 24h)';
--     end if;
--     insert into public.coffee_chat_cancellations (user_id, coffee_chat_id, member_id, meeting_time)
--     values (auth.uid(), old.id, old.member_id, old.meeting_time);
--   end if;
--   return new;
-- end;
-- $$;
-- drop trigger if exists coffee_chat_cancel_limit on public.coffee_chats;
-- create trigger coffee_chat_cancel_limit before update on public.coffee_chats
--   for each row execute function public.enforce_coffee_chat_cancel_limit();
