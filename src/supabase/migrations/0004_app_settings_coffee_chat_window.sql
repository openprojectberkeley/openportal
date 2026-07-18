-- App-wide settings (single row). Currently holds the coffee-chat booking
-- window that managers set availability within; VP Tech edits it from the
-- manager coffee-chats page.
create table if not exists public.app_settings (
  id                smallint primary key default 1,
  coffee_chat_start date not null,
  coffee_chat_end   date not null,
  updated_at        timestamptz not null default now(),
  constraint app_settings_single_row check (id = 1)
);

insert into public.app_settings (id, coffee_chat_start, coffee_chat_end)
values (1, '2026-08-01', '2026-08-31')
on conflict (id) do nothing;

-- Helper: is the current user VP Tech?
create or replace function public.is_vp_tech()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.members_roles mr
    join public.roles r on r.id = mr.role_id
    where mr.user_id = auth.uid()
      and r.role_name = 'VP Tech'
  );
$$;

grant execute on function public.is_vp_tech() to authenticated;

alter table public.app_settings enable row level security;

-- Everyone signed in can read the window (managers need it to build the grid).
drop policy if exists "app_settings_select" on public.app_settings;
create policy "app_settings_select"
on public.app_settings
for select
to authenticated
using ( true );

-- Only VP Tech can create/update it.
drop policy if exists "app_settings_insert_vp_tech" on public.app_settings;
create policy "app_settings_insert_vp_tech"
on public.app_settings
for insert
to authenticated
with check ( public.is_vp_tech() );

drop policy if exists "app_settings_update_vp_tech" on public.app_settings;
create policy "app_settings_update_vp_tech"
on public.app_settings
for update
to authenticated
using ( public.is_vp_tech() )
with check ( public.is_vp_tech() );
