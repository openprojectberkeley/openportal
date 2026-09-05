-- Lets an OP Studio PM/exec choose whether their project's coffee chat is a hard
-- requirement (blocks the applicant's submission until a chat with a PM is
-- completed) or just a recommendation. Only meaningful for type='studio'.
-- Default true preserves the existing "required" wording shown on studio cards.
-- Writes go through the existing projects UPDATE RLS policy (0017) — no new policy.

alter table public.projects
  add column if not exists coffee_chat_required boolean not null default true;
