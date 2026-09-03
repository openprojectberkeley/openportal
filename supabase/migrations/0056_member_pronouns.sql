-- Add member pronouns + a per-member "visible to everyone" toggle.
--
-- Pronouns are collected during onboarding and editable from the profile dialog.
-- `pronouns_public` defaults to true (visible to everyone) so the toggle starts
-- ON; when a member turns it off, the public-profile API strips pronouns for
-- other viewers (RLS on `members` exposes all columns to any signed-in member,
-- so the gating can't be expressed at column granularity — it's enforced
-- server-side in src/app/api/members/[userId]/route.ts). The owner always sees
-- and edits their own value.

alter table public.members
  add column if not exists pronouns text,
  add column if not exists pronouns_public boolean not null default true;
