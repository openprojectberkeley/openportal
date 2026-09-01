-- Pre-signup duplicate-account check.
--
-- The signup form (src/components/email-password-form.tsx) can't tell whether
-- an email already has an account: there is no service-role client in Next.js,
-- and `members` is onboarding-gated so it isn't a reliable source of truth.
-- With email-enumeration protection ON, supabase.auth.signUp for an existing
-- email returns an obfuscated success (a user with an empty identities array,
-- no session, no email sent), which the form used to misread as "check your
-- email" -- a dead end for returning users (96% of whom signed up via Google).
--
-- This SECURITY DEFINER function lets an unauthenticated client ask, before
-- signing up, whether an account exists for a berkeley.edu email and which
-- provider(s) it uses, so the form can steer them to the right sign-in method.
--
-- Disclosure is deliberately minimal: booleans only, and gated to @berkeley.edu
-- (the only domain the app allows) so it isn't a general email-enumeration
-- oracle. This is advisory UX, not a security boundary -- the unique email in
-- auth.users remains the real guard against duplicate accounts.
create or replace function public.account_exists(p_email text)
returns table(found boolean, has_password boolean, has_google boolean)
language sql
security definer
set search_path = ''
stable
as $$
  with normalized as (select lower(trim(p_email)) as email),
  u as (
    select auth.users.id
    from auth.users, normalized
    where lower(auth.users.email) = normalized.email
      and normalized.email like '%@berkeley.edu'
  )
  select
    exists(select 1 from u),
    exists(
      select 1 from auth.identities i join u on i.user_id = u.id
      where i.provider = 'email'
    ),
    exists(
      select 1 from auth.identities i join u on i.user_id = u.id
      where i.provider = 'google'
    );
$$;

-- Signup runs while unauthenticated, so anon must be able to call this.
revoke all on function public.account_exists(text) from public;
grant execute on function public.account_exists(text) to anon, authenticated;
