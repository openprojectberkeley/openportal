-- Located notes on resume reviews, on a PDF that can't change underneath them.
--
-- `resume_reviews.resume_path` points at the person's single resume object,
-- which every re-upload replaces, so it can't anchor a note to a place on a
-- page. Each request now gets its own frozen PDF in `resume-review-files`,
-- written only by /api/resume-reviews with the service role.
--
-- A note's position is stored as fractions (0 to 1) of the displayed page. See
-- src/lib/resume-note-geometry.ts, which applies the same rules in the browser.
--
-- Additive: the current app keeps working until 0113 removes the old write paths.

alter table public.resume_reviews add column if not exists file_path text;

-- ---------------------------------------------------------------------------
-- Frozen files
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resume-review-files', 'resume-review-files', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read only. There are deliberately no write policies: a requester must not be
-- able to swap the file after reviewers have started marking it up.
drop policy if exists "resume_review_files_read" on storage.objects;
create policy "resume_review_files_read"
on storage.objects
for select to authenticated
using (
  bucket_id = 'resume-review-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_exec())
  )
);

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

create or replace function public.resume_note_rects_valid(p_kind text, p_rects jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_rect jsonb;
  v_x double precision;
  v_y double precision;
  v_w double precision;
  v_h double precision;
begin
  if jsonb_typeof(p_rects) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_rects) = 0
     or jsonb_array_length(p_rects) > (case when p_kind = 'text' then 200 else 1 end) then
    return false;
  end if;

  for v_rect in select value from jsonb_array_elements(p_rects) loop
    if jsonb_typeof(v_rect) is distinct from 'object'
       or jsonb_typeof(v_rect -> 'x') is distinct from 'number'
       or jsonb_typeof(v_rect -> 'y') is distinct from 'number'
       or jsonb_typeof(v_rect -> 'w') is distinct from 'number'
       or jsonb_typeof(v_rect -> 'h') is distinct from 'number' then
      return false;
    end if;

    v_x := (v_rect ->> 'x')::double precision;
    v_y := (v_rect ->> 'y')::double precision;
    v_w := (v_rect ->> 'w')::double precision;
    v_h := (v_rect ->> 'h')::double precision;

    if v_x < 0 or v_y < 0 or v_w < 0 or v_h < 0
       or v_x + v_w > 1.000000001 or v_y + v_h > 1.000000001 then
      return false;
    end if;
    if p_kind = 'point' and (v_w <> 0 or v_h <> 0) then
      return false;
    end if;
    if p_kind <> 'point' and (v_w = 0 or v_h = 0) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create table if not exists public.resume_review_notes (
  id         uuid primary key default gen_random_uuid(),
  review_id  uuid not null references public.resume_reviews (id) on delete cascade,
  author_id  uuid references auth.users (id) on delete set null,
  page       integer not null check (page >= 1),
  kind       text not null check (kind in ('point', 'box', 'text')),
  rects      jsonb not null,
  quote      text check (quote is null or char_length(quote) <= 2000),
  body       text not null check (btrim(body) <> '' and char_length(body) <= 4000),
  created_at timestamptz not null default now(),
  constraint resume_review_notes_rects_valid check (public.resume_note_rects_valid(kind, rects)),
  constraint resume_review_notes_quote_kind check ((kind = 'text') = (quote is not null))
);

create index if not exists resume_review_notes_review_page
  on public.resume_review_notes (review_id, page);

alter table public.resume_review_notes enable row level security;

-- Execs share one draft. The requester sees nothing until feedback is sent.
drop policy if exists "resume_review_notes_select" on public.resume_review_notes;
create policy "resume_review_notes_select"
on public.resume_review_notes
for select to authenticated
using (
  (select public.is_exec())
  or exists (
    select 1 from public.resume_reviews r
    where r.id = review_id
      and r.requester_id = (select auth.uid())
      and r.status = 'completed'
  )
);

drop policy if exists "resume_review_notes_insert" on public.resume_review_notes;
create policy "resume_review_notes_insert"
on public.resume_review_notes
for insert to authenticated
with check (
  (select public.is_exec())
  and author_id = (select auth.uid())
  and exists (select 1 from public.resume_reviews r where r.id = review_id and r.status = 'pending')
);

drop policy if exists "resume_review_notes_update" on public.resume_review_notes;
create policy "resume_review_notes_update"
on public.resume_review_notes
for update to authenticated
using (
  (select public.is_exec())
  and exists (select 1 from public.resume_reviews r where r.id = review_id and r.status = 'pending')
)
with check (
  (select public.is_exec())
  and exists (select 1 from public.resume_reviews r where r.id = review_id and r.status = 'pending')
);

drop policy if exists "resume_review_notes_delete" on public.resume_review_notes;
create policy "resume_review_notes_delete"
on public.resume_review_notes
for delete to authenticated
using (
  (select public.is_exec())
  and exists (select 1 from public.resume_reviews r where r.id = review_id and r.status = 'pending')
);

-- A note's text can be edited; its location and author can't.
revoke all on public.resume_review_notes from anon, authenticated;
grant select, insert, delete on public.resume_review_notes to authenticated;
grant update (body) on public.resume_review_notes to authenticated;

-- ---------------------------------------------------------------------------
-- Overall comment draft
-- ---------------------------------------------------------------------------

-- Separate from resume_reviews because requesters can read their whole row there.
create table if not exists public.resume_review_drafts (
  review_id  uuid primary key references public.resume_reviews (id) on delete cascade,
  body       text not null default '' check (char_length(body) <= 20000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.resume_review_drafts enable row level security;

drop policy if exists "resume_review_drafts_select" on public.resume_review_drafts;
create policy "resume_review_drafts_select"
on public.resume_review_drafts
for select to authenticated
using ( (select public.is_exec()) );

drop policy if exists "resume_review_drafts_insert" on public.resume_review_drafts;
create policy "resume_review_drafts_insert"
on public.resume_review_drafts
for insert to authenticated
with check (
  (select public.is_exec())
  and updated_by = (select auth.uid())
  and exists (select 1 from public.resume_reviews r where r.id = review_id and r.status = 'pending')
);

drop policy if exists "resume_review_drafts_update" on public.resume_review_drafts;
create policy "resume_review_drafts_update"
on public.resume_review_drafts
for update to authenticated
using (
  (select public.is_exec())
  and exists (select 1 from public.resume_reviews r where r.id = review_id and r.status = 'pending')
)
with check (
  (select public.is_exec())
  and updated_by = (select auth.uid())
  and exists (select 1 from public.resume_reviews r where r.id = review_id and r.status = 'pending')
);

revoke all on public.resume_review_drafts from anon, authenticated;
grant select, insert, update on public.resume_review_drafts to authenticated;

-- ---------------------------------------------------------------------------
-- Sending and withdrawing
-- ---------------------------------------------------------------------------

-- Same contract as 0100, except that notes alone now count as feedback.
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
  v_feedback  text := nullif(btrim(coalesce(p_feedback, '')), '');
  v_name      text;
begin
  if not public.is_exec() then
    raise exception 'not authorized';
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

  if v_feedback is null
     and not exists (select 1 from public.resume_review_notes n where n.review_id = p_review_id) then
    raise exception 'feedback is required';
  end if;

  update public.resume_reviews
     set status       = 'completed',
         feedback     = v_feedback,
         reviewer_id  = v_reviewer,
         completed_at = now()
   where id = p_review_id;

  delete from public.resume_review_drafts where review_id = p_review_id;

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

revoke execute on function public.complete_resume_review(uuid, text) from public, anon;
grant  execute on function public.complete_resume_review(uuid, text) to authenticated;

-- Withdraws the caller's own pending request and returns its frozen file, which
-- /api/resume-reviews/[id] then deletes.
create or replace function public.withdraw_resume_review(p_review_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file_path text;
begin
  update public.resume_reviews
     set status = 'cancelled'
   where id = p_review_id
     and requester_id = auth.uid()
     and status = 'pending'
  returning file_path into v_file_path;

  if not found then
    raise exception 'review not found or already handled';
  end if;

  delete from public.resume_review_notes where review_id = p_review_id;
  delete from public.resume_review_drafts where review_id = p_review_id;

  return v_file_path;
end;
$$;

revoke execute on function public.withdraw_resume_review(uuid) from public, anon;
grant  execute on function public.withdraw_resume_review(uuid) to authenticated;
