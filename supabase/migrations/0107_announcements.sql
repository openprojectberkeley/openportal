-- Announcement banners: exec posts a colored message with a start/end window;
-- every signed-in user sees the live ones at the top of the dashboard.
--
-- Reads are open to all authenticated users (the dashboard filters to the live
-- window client-side); only exec can create, edit or delete.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null check (length(btrim(message)) > 0),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_window check (ends_at > starts_at)
);

create index if not exists announcements_window_idx
  on public.announcements(starts_at, ends_at);

alter table public.announcements enable row level security;

drop policy if exists "announcements_select" on public.announcements;
create policy "announcements_select"
on public.announcements for select to authenticated
using (true);

drop policy if exists "announcements_insert" on public.announcements;
create policy "announcements_insert"
on public.announcements for insert to authenticated
with check ((select public.is_exec()));

drop policy if exists "announcements_update" on public.announcements;
create policy "announcements_update"
on public.announcements for update to authenticated
using ((select public.is_exec()))
with check ((select public.is_exec()));

drop policy if exists "announcements_delete" on public.announcements;
create policy "announcements_delete"
on public.announcements for delete to authenticated
using ((select public.is_exec()));
