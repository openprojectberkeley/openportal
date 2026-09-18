-- Resume review: an on-demand service, not a step in the application.
--
-- Anyone signed in can ask for feedback on the resume they already have on file
-- (`members.resume_path`, uploaded on the application page into the private
-- `application-resumes` bucket). An exec reviewer picks the request up,
-- writes feedback, and the requester is notified in-app + by email.
--
-- Two things are deliberate here:
--
--   * `resume_path` is SNAPSHOTTED onto the request row rather than joined from
--     `members`. A person has exactly one resume object, ever, and re-uploading
--     replaces it (see lib/resume-upload.ts). Without a snapshot, feedback
--     written about v1 would silently re-point at v3 and read as nonsense.
--
--   * Completing a review goes through a SECURITY DEFINER RPC, because it has
--     to insert a notification addressed to the REQUESTER. The 0026 RLS insert
--     policy only lets a client self-insert `type='reminder'`, so a reviewer
--     cannot write that row directly — same shape as
--     notify_coffee_chat_counterparty().

create table if not exists public.resume_reviews (
  id              uuid primary key default gen_random_uuid(),
  requester_id    uuid not null references auth.users (id) on delete cascade,
  -- Snapshot of the resume as it stood when the review was requested.
  resume_path     text not null,
  resume_filename text,
  -- Two optional questions asked at request time. Both may be null: the
  -- requester can ask for a look without a target role or a deadline.
  target_roles    text,
  needed_by       date,
  status          text not null default 'pending'
                    check (status in ('pending', 'completed', 'cancelled')),
  reviewer_id     uuid references auth.users (id) on delete set null,
  feedback        text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

-- Queue fetch (oldest first) and the requester's own history (newest first).
create index if not exists resume_reviews_status_created
  on public.resume_reviews (status, created_at);
create index if not exists resume_reviews_requester_created
  on public.resume_reviews (requester_id, created_at desc);

-- One open request per person. Completed/cancelled rows stay as history, so a
-- PARTIAL index is what expresses "you can ask again, but not queue up twice".
create unique index if not exists resume_reviews_one_pending_per_requester
  on public.resume_reviews (requester_id) where status = 'pending';

-- Additive, for a database where an earlier draft of this file already ran
-- (the original shipped a single free-text `note` instead of the two
-- questions above).
alter table public.resume_reviews add column if not exists target_roles text;
alter table public.resume_reviews add column if not exists needed_by date;
alter table public.resume_reviews drop column if exists note;

alter table public.resume_reviews enable row level security;

-- Requester reads own; exec reads everything (they staff the queue). Note this
-- is is_exec(), NOT is_board_or_exec() -- reviewing is exec-only, unlike the
-- application review flow that board also works.
drop policy if exists "resume_reviews_select" on public.resume_reviews;
create policy "resume_reviews_select"
on public.resume_reviews
for select to authenticated
using ( requester_id = (select auth.uid()) or public.is_exec() );

-- Requester creates own, and only in the 'pending' state with no feedback
-- pre-filled. The partial unique index above stops a second concurrent one.
drop policy if exists "resume_reviews_insert_own" on public.resume_reviews;
create policy "resume_reviews_insert_own"
on public.resume_reviews
for insert to authenticated
with check (
  requester_id = (select auth.uid())
  and status = 'pending'
  and reviewer_id is null
  and feedback is null
  and completed_at is null
);

-- Requester may withdraw a request that hasn't been answered yet. RLS can't
-- diff OLD vs NEW, so the WITH CHECK pins the landing state to 'cancelled' and
-- the USING clause keeps them out of anything already completed.
drop policy if exists "resume_reviews_cancel_own" on public.resume_reviews;
create policy "resume_reviews_cancel_own"
on public.resume_reviews
for update to authenticated
using ( requester_id = (select auth.uid()) and status = 'pending' )
with check ( requester_id = (select auth.uid()) and status = 'cancelled' );

-- Reviewers work the queue through complete_resume_review() below, which runs
-- as definer; no exec UPDATE policy is granted here on purpose, so the
-- notification can never be skipped by writing the row directly.

-- ---------------------------------------------------------------------------
-- Notification types
-- ---------------------------------------------------------------------------

-- Widen the 0026 CHECK to carry resume-review notices alongside the coffee-chat
-- ones. Re-stated in full because a CHECK constraint can't be appended to.
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (type in (
    'reminder',
    'chat_booked',
    'chat_cancelled_by_applicant',
    'chat_cancelled_by_host',
    'location_added',
    'location_updated',
    'resume_review_completed'
  ));

-- Email the requester when feedback lands. The edge function only builds an ICS
-- for CALENDAR_TYPES, so a resume-review row sends a plain title/body email and
-- needs no function change.
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
  -- Cross-user events only. Reminders never email.
  if new.type not in (
    'chat_booked',
    'chat_cancelled_by_applicant',
    'chat_cancelled_by_host',
    'location_added',
    'location_updated',
    'resume_review_completed'
  ) then
    return new;
  end if;

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

-- ---------------------------------------------------------------------------
-- complete_resume_review(): the only way to answer a request
-- ---------------------------------------------------------------------------

create or replace function public.complete_resume_review(
  p_review_id uuid,
  p_feedback  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid;
  v_reviewer  uuid := auth.uid();
  v_name      text;
begin
  if not public.is_exec() then
    raise exception 'not authorized';
  end if;

  if p_feedback is null or btrim(p_feedback) = '' then
    raise exception 'feedback is required';
  end if;

  -- Lock the row so two reviewers submitting at once can't both "win" and
  -- double-notify the requester.
  select requester_id into v_requester
    from public.resume_reviews
   where id = p_review_id and status = 'pending'
     for update;

  if v_requester is null then
    raise exception 'review not found or already handled';
  end if;

  update public.resume_reviews
     set status       = 'completed',
         feedback     = p_feedback,
         reviewer_id  = v_reviewer,
         completed_at = now()
   where id = p_review_id;

  select coalesce(nullif(btrim(coalesce(preferred_firstname, '') || ' ' || coalesce(lastname, '')), ''), 'A reviewer')
    into v_name
    from public.members
   where user_id = v_reviewer;

  -- Recipient is derived from the row, never from client input.
  insert into public.notifications (user_id, type, title, body, actor_id)
  values (
    v_requester,
    'resume_review_completed',
    'Your resume review is ready',
    coalesce(v_name, 'A reviewer') || ' left feedback on your resume.',
    v_reviewer
  );
end;
$$;

-- 0097: strip the implicit PUBLIC grant, not just the anon one.
revoke execute on function public.complete_resume_review(uuid, text) from public, anon;
grant  execute on function public.complete_resume_review(uuid, text) to authenticated;
