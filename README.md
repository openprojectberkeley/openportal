<a href="https://demo-nextjs-with-supabase.vercel.app/">
  <img alt="Next.js and Supabase Starter Kit - the fastest way to build apps with Next.js and Supabase" src="https://demo-nextjs-with-supabase.vercel.app/opengraph-image.png">
  <h1 align="center">Next.js and Supabase Starter Kit</h1>
</a>

<p align="center">
 The fastest way to build apps with Next.js and Supabase
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#deploy"><strong>Deploy</strong></a> ·
  <a href="#clone-and-run-locally"><strong>Run locally</strong></a> ·
  <a href="#feedback-and-issues"><strong>Feedback and issues</strong></a>
</p>
<br/>

# someone better close this portal

## Features

- Works across the entire [Next.js](https://nextjs.org) stack
  - App Router
  - Pages Router
  - Proxy
  - Client
  - Server
  - It just works!
- supabase-ssr. A package to configure Supabase Auth to use cookies
- Password-based authentication block installed via the [Supabase UI Library](https://supabase.com/ui/docs/nextjs/password-based-auth)
- Styling with [Tailwind CSS](https://tailwindcss.com)
- Components with [shadcn/ui](https://ui.shadcn.com/)
- Deploys to GitHub Pages at [portal.openprojectberkeley.com](https://portal.openprojectberkeley.com)

## Deploy

The site deploys automatically via GitHub Actions when you push to `main`.

**Live site:** [portal.openprojectberkeley.com](https://portal.openprojectberkeley.com)

### One-time setup

1. **Enable GitHub Pages** — in the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.

2. **Add secrets** — go to **Settings → Secrets and variables → Actions** and add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

   Use the same values as your local `.env` file.

3. **Configure the custom domain** — in **Settings → Pages → Custom domain**, enter:

   ```
   portal.openprojectberkeley.com
   ```

   DNS should have a CNAME record pointing `portal` to `openprojectberkeley.github.io`. The domain is also saved in `public/CNAME` so it persists across deploys. Enable **Enforce HTTPS** once GitHub offers it.

4. **Configure Supabase** — in your [Supabase project](https://supabase.com/dashboard) go to **Authentication → URL configuration** and set:
   - **Site URL:** `https://portal.openprojectberkeley.com`
   - **Redirect URL:** `https://portal.openprojectberkeley.com/auth/confirm`

### Deploy a new version

Commit your changes and push to `main`:

```bash
git push origin main
```

GitHub Actions will build the static site and publish it. You can also trigger a deploy manually from the **Actions** tab → **Deploy to GitHub Pages** → **Run workflow**.

### Test the production build locally

```bash
npm run build:pages
```

This writes a static site to the `out/` folder using the same settings as the GitHub Pages deploy.

## Clone and run locally

1. Create a [Supabase project](https://database.new) if you don't have one.

2. Copy `.env.example` to `.env` and fill in your Supabase credentials:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
   ```

   Both values are in [your project's API settings](https://supabase.com/dashboard/project/_?showConnect=true).

3. Install dependencies and start the dev server:

   ```bash
   npm install
   npm run dev
   ```

   The app runs at [localhost:3000](http://localhost:3000/).

## Feedback and issues

Please file feedback and issues over on the [Supabase GitHub org](https://github.com/supabase/supabase/issues/new/choose).

## More Supabase examples

- [Next.js Subscription Payments Starter](https://github.com/vercel/nextjs-subscription-payments)
- [Cookie-based Auth and the Next.js 13 App Router (free course)](https://youtube.com/playlist?list=PL5S4mPUpp4OtMhpnp93EFSo42iQ40XjbF)
- [Supabase Auth and the Next.js App Router](https://github.com/supabase/supabase/tree/master/examples/auth/nextjs)
