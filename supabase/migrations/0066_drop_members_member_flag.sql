-- Drop the vestigial members.member boolean.
--
-- `members.member` ("true = member/past member, false = non-member") predates
-- the migration history (it was created directly in the dashboard, like the
-- members table and its RLS). It was functionally superseded by the
-- members.status enum introduced in 0042 (active / inactive / non_member /
-- blacklisted) and has been dead ever since:
--
--   * no migration creates or references it;
--   * no application code, edge function, RLS policy, view, index, constraint,
--     default, generated column, or database function references it
--     (verified against the live DB via pg_depend + a scan of every routine
--     body, all empty);
--   * its data is vestigial -- 1 of 542 rows was `true` (and that row is
--     already status='active'), the rest `false`.
--
-- `status` is the single source of truth for membership state, so the column
-- is removed outright. Idempotent.

alter table public.members drop column if exists member;
