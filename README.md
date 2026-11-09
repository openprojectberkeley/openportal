# Open Portal

The member portal for [Open Project](https://openprojectberkeley.com) at UC Berkeley. Live at **[portal.openprojectberkeley.com](https://portal.openprojectberkeley.com)**.

Built with Next.js (App Router), Supabase (Postgres, Auth, Storage, Edge Functions), Tailwind CSS and shadcn/ui. Hosted on Vercel.

## Features

| Area | Route | What it does |
| --- | --- | --- |
| Portals | `/`, `/portals/[id]` | Dashboard of portals (projects, teams, families) with members, attendance and content |
| Calendar | `/calendar` | Club events mirrored from the Open Project Google Calendar, with a subscribe link |
| Coffee chats | `/coffee-chat` | Applicants book coffee chats with members in a booking window set by admins |
| Infosessions | `/infosession` | Infosession sign-in and attendance tracking |
| Applications | `/application` | Recruiting applications for projects |
| Resume review | `/resume-review` | Resume submission and a review queue |
| Scoreboard | `/scoreboard` | Family points scoreboard and points ledger |
| Manager | `/manager` | Review coffee chats, infosession attendance, applications and the draft |
| Admin | `/admin` | Member, role, portal and project management |
| Onboarding | `/onboarding` | Profile setup for new members |

Sign-in uses email/password or Google and is limited to `@berkeley.edu` addresses. Access depends on a member's roles: for example, VP Tech and President get elevated tools (see [`src/lib/roles.ts`](src/lib/roles.ts)), and authorization is enforced in Postgres with RLS.

## Getting started

Requires Node.js 24+ and npm. You'll also need the [Supabase CLI](https://supabase.com/docs/guides/local-development) if you work on the database or edge functions.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill it in (see [Environment variables](#environment-variables)). Only the two Supabase values are required to run the app.

3. Start the dev server:

   ```bash
   npm run dev
   ```

   The app runs at [localhost:3000](http://localhost:3000).

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm test` / `npm run test:watch` | Vitest unit tests |
| `npm run generate:icons` | Regenerate app icons ([`scripts/generate-app-icons.mjs`](scripts/generate-app-icons.mjs)) |

The booking integration tests in [`src/lib/__tests__/booking.db.test.ts`](src/lib/__tests__/booking.db.test.ts) need a local Supabase stack and are skipped unless `RUN_DB_TESTS=1` is set. The file header has the exact command.

## Environment variables

Next.js app variables (`.env` locally, Vercel project settings in production):

| Variable | Required | Exposed to browser | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Yes | Supabase publishable (anon) key |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | No | Yes | Google OAuth client for the coffee-chat free/busy sync. If unset, the "Sync with Google Calendar" button is hidden |
| `NEXT_PUBLIC_OPEN_PROJECT_CALENDAR_ID` | No | Yes | Public Google Calendar to mirror. If unset, the Subscribe button is hidden and calendar sync is disabled |
| `GOOGLE_CALENDAR_API_KEY` | For calendar sync | No | Google Cloud API key restricted to the Calendar API |
| `SUPABASE_SERVICE_ROLE_KEY` | For calendar sync | **No, never prefix with `NEXT_PUBLIC_`** | Bypasses RLS; used only by the calendar sync route |
| `CRON_SECRET` | For calendar sync | No | Bearer token Vercel Cron sends to `/api/admin/calendar-sync` |

Edge function secrets (set with `supabase secrets set` or in the Supabase dashboard):

| Secret | Used by | Purpose |
| --- | --- | --- |
| `SMTP2GO_API_KEY` | both functions | Sends email via SMTP2GO |
| `EMAIL_FROM` | both functions | Verified sender (defaults to `Open Portal <noreply@openprojectberkeley.com>`) |
| `WEBHOOK_SECRET` | `send-notification-email` | Shared secret; must match the Vault secret `notification_email_secret` |
| `APP_URL` | `send-notification-email` | Optional base URL for links in emails |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into edge functions by the platform.

## Supabase

### Migrations

Schema, RLS policies, RPCs and triggers are in numbered SQL files in [`supabase/migrations/`](supabase/migrations). To change the schema, add a new file with the next number (`NNNN_short_description.sql`). Don't edit migrations that have already been applied.

Apply migrations to the linked project:

```bash
supabase link --project-ref yplpbzjdawynnrqdcmpt
```

```bash
supabase db push
```

To run the stack locally (needed for the DB tests), run `supabase start`; `supabase status` prints the local URL and keys.

### Edge functions

| Function | Trigger | Auth |
| --- | --- | --- |
| [`send-notification-email`](supabase/functions/send-notification-email) | The `trg_notification_email` Postgres trigger calls it through `pg_net` | Shared `x-webhook-secret` header (`--no-verify-jwt`) |
| [`send-support-email`](supabase/functions/send-support-email) | The in-app help button calls it through `supabase.functions.invoke()` | User JWT; emails every member with the VP Tech role |

Deploy a function:

```bash
supabase functions deploy send-notification-email --no-verify-jwt
```

```bash
supabase functions deploy send-support-email
```

## Deployment

The site is hosted on **Vercel**, which deploys automatically on every push to `main`. Preview deployments are created for other branches.

Production setup:

- **Vercel env vars:** set every app variable from the table above in the Vercel project settings.
- **Cron:** [`vercel.json`](vercel.json) runs `/api/admin/calendar-sync` daily at 13:00 UTC to mirror the Google Calendar into `portal_events`. It needs `CRON_SECRET`.
- **Supabase Auth URLs:** in Supabase, go to **Authentication → URL configuration**. Set the Site URL to `https://portal.openprojectberkeley.com`, and add `/auth/callback`, `/auth/confirm` and `/auth/update-password` on that domain as redirect URLs.

## Project structure

```
src/
  app/
    (app)/          signed-in pages (portals, calendar, coffee-chat, scoreboard, manager, …)
    admin/          admin console
    api/            route handlers (admin, members, calendar sync)
    auth/           login, OAuth callback, email confirm, password reset
    onboarding/     new-member setup
  components/       feature components; ui/ holds shadcn/ui primitives
  lib/              domain logic, data hooks, Supabase clients (lib/supabase/)
  proxy.ts          refreshes the Supabase session on each request
supabase/
  migrations/       SQL schema history
  functions/        edge functions
scripts/            one-off SQL and icon generation
docs/api.md         HTTP API notes
```
