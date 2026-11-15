---
name: Open Portal
description: The Open Project @ Berkeley member portal. A quiet, tinted shell where colour comes from the club itself.
colors:
  # Canonical values are the HSL channel triplets in src/app/globals.css
  # (`hsl(var(--token))`). Light theme listed; dark mirrors each role on the
  # same hue-255 tint (see Colors).
  background: "hsl(255 20% 97%)"
  foreground: "hsl(255 12% 12%)"
  card: "hsl(255 24% 99%)"
  popover: "hsl(255 24% 99%)"
  primary: "hsl(255 12% 15%)"
  primary-foreground: "hsl(255 20% 98%)"
  secondary: "hsl(255 16% 93.5%)"
  muted: "hsl(255 16% 94%)"
  muted-foreground: "hsl(255 8% 44%)"
  accent: "hsl(255 18% 92%)"
  border: "hsl(255 30% 20% / 0.09)"
  input: "hsl(255 30% 20% / 0.16)"
  ring: "hsl(255 12% 40%)"
  success: "hsl(152 62% 32%)"
  warning: "hsl(32 92% 40%)"
  info: "hsl(221 78% 50%)"
  destructive: "hsl(0 72% 51%)"
  dark-background: "hsl(255 14% 5%)"
  dark-card: "hsl(255 12% 7.5%)"
  dark-muted: "hsl(255 10% 10.5%)"
  dark-border: "hsl(255 25% 92% / 0.075)"
typography:
  display:
    fontFamily: "Satoshi, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Satoshi, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Satoshi, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: "tnum"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
  data:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontWeight: 600
    fontFeature: "tnum"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  gutter: "20px"
  stack: "24px"
  tile: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "36px"
  surface-tint:
    backgroundColor: "hsl(var(--foreground) / 0.035)"
    rounded: "{rounded.xl}"
    padding: "16px"
  list-row:
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  input:
    backgroundColor: "transparent"
    rounded: "{rounded.md}"
    height: "36px"
  tooltip:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
---

# Open Portal design system

The rules here were settled in the late-2026 redesign, which moved the site off the Vercel/shadcn starter look. Wherever this file and the code disagree, follow the token files: `src/app/globals.css`, `tailwind.config.ts` and `src/lib/motion.ts`. Then update this file to match.

## Overview

**North star: a quiet shell, with colour coming from the club.** The interface around the content is calm, monochrome and slightly cool (every neutral carries a faint hue-255 tint). Colour comes from the things the club is made of: a portal's accent, a family's colour, an event category, a status. The six-colour logo is the only rainbow on the site.

The product is a tool that people use several times a week, so the guiding principles are:

- **Instant.** Edits show on screen the moment you click, and frequent hovers respond within ~100ms. When something animates, it's because the motion is doing a job.
- **Quiet.** Use as few outlines as possible, and only faint ones. Group things with spacing and a light tint, not boxes.
- **Self-explanatory.** If the UI already says something, don't print it again as a label or description. Explanations live behind a hover or help hint.

## Colors

**Neutrals.** Every neutral token has hue 255 and very low saturation, in both themes, so the two themes read as one product. Light mode is an off-white (`--background: 255 20% 97%`), never pure white. Dark mode sits at 5% lightness, with cards and muted surfaces stepped up from there by small amounts.

**Colour only for meaning.** Use colour for exactly two things:

1. **Identity:** portal accents, family colours, event categories, announcement banners. Admins choose these, from any hex value.
2. **Status:** `success`, `warning`, `info` and `destructive`. Each has its own value per theme in `globals.css`, tuned for text contrast. For soft fills use `bg-success/15 text-success` and the matching pattern for the others.

Never write raw Tailwind palette colours like `green-600`, `red-500` or `amber-*` in components. About 58 older files still do; convert them whenever you touch one.

**Accent surfaces** are any surface filled with an identity colour: event cards, calendar chips, banners, the portal-card swipe.
- They are a flat fill. No gradients and no sheen.
- Text on them comes from `readableTextColor()`.
- Their edge is `accentRing(color)` from `src/lib/portal-color.ts`: a 1px inset ring in the surface's own colour at 14%.
- When an accent is used for a data mark, such as a scoreboard bar, pass it through `visibleMarkColor()` first. Very dark accents would otherwise vanish against the dark track.

**Charts** use the `--chart-1..5` tokens.

## Typography

- **Display face: Satoshi.** It's self-hosted from `src/fonts/satoshi/` (ITF Free Font License) and exposed as `font-display`. A base rule puts every `h1`, `h2` and `h3` in it, along with `DialogTitle`, `CardTitle` and the wordmarks.
- **Body face: Geist.** Used for everything else.
- **Data face: Geist Mono.** Only for data that has to line up: scores, points, ranks and codes. Never use it as decoration.

**Page titles** come in two sizes:

| Pages | Classes |
|---|---|
| Top-level pages (Dashboard, Calendar, Scoreboard, Attendance) | `text-4xl font-bold tracking-tight` |
| Tool and sub-pages (manager, admin, review queues) | `text-2xl font-bold tracking-tight` |

**Section headings** are real `h2` elements in sentence case: `text-base font-semibold tracking-tight`, followed by a muted count, as in "Portals 20". **In-panel labels** (small headings inside a panel, table or stat group) may stay `text-xs font-semibold uppercase tracking-wide text-muted-foreground`. Never put an uppercase "eyebrow" above a page or section heading.

**Numbers.** `body` sets `font-variant-numeric: tabular-nums` app-wide, so counts, timers, badges and scores don't jitter as they change. `.prose`, used for long-form markdown pages, opts back out to proportional digits.

## Layout

- **Page container:** `max-w-6xl mx-auto p-5` for wide pages, `max-w-3xl` for single-column pages.
- **Spacing:** vertical rhythm is `gap-6` between sections and `gap-3` to `gap-4` inside them.
- **Lists group by spacing, not rules:**
  - rows are `rounded-lg px-4 py-3` with a `hover:bg-foreground/[0.03]` tint
  - the list wrapper is `flex flex-col gap-0.5`
  - no `divide-y`, no `border-t` between rows
- **Grouped content** sits on a `.surface` (`rounded-xl surface p-4`: tint plus a faint rim), never in an outlined box.
- **Dialog footers** are separated from the body by spacing alone (`pt-2`), not a rule.
- **Floating dock:** the "View as" switch and Help button share one dock fixed to the bottom-right. Page content and the footer leave room for it.
- **Mobile:** layouts must work down to 375px. The header tabs drop to icon-only below `sm`.

**Progressive disclosure.** Explanations of what a control or number means are not printed on the page. They sit behind `<InfoHint>` (`src/components/ui/info-hint.tsx`), a small ? that shows a tooltip on hover or focus. Delete any label the UI already makes obvious. Optional or advanced inputs belong behind a toggle, a collapsible section, or a ⋯ menu.

## Elevation & Depth

The system is flat with tonal layering, and only floating surfaces lift.

- **Edges** are translucent hairlines. `--border` is a dark (light theme) or light (dark theme) ink at 7–9% alpha, so the edge takes on the colour of whatever surface it sits on and reads as glass rather than as a grey rule. Form fields get a little more (`--input`, 12–16%) so they stay findable.
- **Floating surfaces** (dialog, dropdown, popover, hover-card, toast) use `shadow-overlay`. It is a lit top edge (`--edge-hi`) plus a soft drop shadow, on a faint 1px border.
- **Raised cards that sit over colour** (for example the calendar panel over its portal band) use `shadow-edge`.
- **Cards** get at most `hover:shadow-md`. Nothing else casts a shadow.
- **Glass is for floating layers only.**
  - Menus, popovers, hover cards, toasts, the floating dock and the sticky header use `.glass` or `.glass-bar` (defined in `globals.css`). The layer keeps 66–72% of its own colour and blurs and saturates the page behind it, so the cards underneath tint it.
  - Dialogs use `.glass-strong` (about 85%, because they hold forms) over a `bg-black/40` scrim with a 2px blur.
  - Content surfaces (cards, panels, rows) get the rim, but never the blur.
  - Where `backdrop-filter` isn't supported, every glass class falls back to an opaque surface.
- **The gradient rim, the system's one edge.** A 1px ring on `::before`: bright where light falls (160°, top-left), fading to nothing along the sides, with a faint return at the far corner. In dark mode the return is white; in light mode it's dark ink (`--rim-ink-color`), because a white line vanishes on light surfaces. It never takes clicks and costs no layout.
  - **Three strengths** (`--rim-k` × `--rim-light`, which is 0.35 dark / 0.6 light):

    | Class | Strength | Used for |
    |---|---|---|
    | `.rim`, `.glass`, `.glass-strong` | 1 | Floating layers |
    | `.rim-card` | 0.6 | Cards: portal, event (and week-grid blocks), coffee-chat, stat tiles, clickable dashboard and manager tiles, the calendar panel, the compact standings card |
    | `.rim-section` / `.surface` | 0.3 | Tinted sections and panels |
  - **`.surface` is the standard section:** the `foreground/0.035` tint plus the section rim. Use it for any grouped panel; add `rim-card` to a surface someone clicks.
  - **Skipped:** list rows (hover tint only), month-grid chips (too small), inputs, tables, and the header bar (its bottom hairline is enough).
  - Other options were compared in the scratch page at `/lab/glass` (not linked from the app).

## Shapes

- **Radius scale:** `--radius` is 8px.
  - `rounded-md` (6px): buttons and inputs
  - `rounded-lg` (8px): rows and small tiles
  - `rounded-xl` (12px): cards and panels
  - `rounded-full`: pills, avatars and dots
- **Border weight:** borders are 1px only, never thick. The 2px active indicators on in-page tab strips are allowed, because they mark state rather than outline anything.
- **Rounded-square tiles:** the 48px portal icons, project icons and family marks are rounded squares. They're accepted as they are; don't add any new superellipse or squircle shapes.
- **Logo shapes:** the three logo shapes (bowl, stem, hook) are always layered with the stem and hook on top of the bowl.

## Motion

The tokens live in `globals.css` (`--dur-*`, `--ease-*`), are exposed in Tailwind as `duration-1..5` and `ease-out-quart`, and are mirrored for JS in `src/lib/motion.ts`.

| Tier | Duration | Used for |
|---|---|---|
| None | 0ms | The portal-card hover (swipe, text colour, ⋯ reveal). The most-hovered thing on the dashboard is fully instant |
| Instant | `--dur-0`, 100ms (`duration-instant`, and the Tailwind default) | Common hovers and selections: rows, menus, chips, arrow nudges |
| Standard | 120–240ms (`duration-1..3`) | Overlays entering, buttons and options that are used rarely (such as the manager pill) |
| Slow | 400–700ms | Data reveals (scoreboard bars) and illustrative motion (the floating logo shapes on the sign-in page) |

**Easing.** Use ease-out for things entering or leaving (`ease-out-quart`, `ease-out-expo`) and ease-in-out for things that move while on screen. Never bounce, and never scale the element being hovered: move a child instead, such as an arrow nudge.

**Exits are faster than entrances.** Dialogs open in 280ms with `ease-out-expo` and close in 150ms.

**Dialogs open from their trigger.** `src/lib/click-origin.ts` records the last press, and `DialogContent` sets its `transform-origin` there, so a dialog grows out of the thing you clicked. If it was opened from the keyboard, it grows from the centre.

**Stagger.** Large collections enter one item after another (`animate-fade-in-up` with `staggerStyle(i)`), 30ms per item and capped at 12 items. This applies only to collections such as portals, rosters, standings and panels; never to tables, menus or short lists.

**Exception: header tabs.** The selected tab's underline morphs into an inverted badge over 300ms, and the hover underline glides in 180ms. This is the site's signature moment and the one deliberate exception to the instant tier.

**Reduced motion.** A global `prefers-reduced-motion` rule clamps animations. Hover styles apply only on devices that support hover (`hoverOnlyWhenSupported`).

## Components

- **Optimistic writes.** Every edit the server can't meaningfully veto goes through `optimistic()` in `src/lib/optimistic.ts`:
  - apply the change locally
  - commit it in the background
  - if it fails, roll back and show a toast with Retry
  - use `.select()` together with `requireRows` so a write silently refused by row-level security (RLS) counts as a failure

  Writes that stay pending, where the server's answer matters:
  - booking a chat
  - submitting an application
  - claiming an info session code
  - onboarding
  - draft reset and complete
  - awarding points
  - creating rows that need a server ID and an icon upload: portals, projects, families, events
- **Toasts** come from `sonner` through `src/components/ui/sonner.tsx`. They appear bottom-centre, clear of the floating dock.
- **Header tabs.** Each tab is a full-height cell. Hover is one gliding 2px underline on the header rule. The selected tab is an inverted, slightly rounded badge.
- **Card grids.** Portal and coffee-chat grids use `auto-rows-fr` with `h-full` cards, so every card in a grid is the same size. Variable text is clamped: portal descriptions to 2 lines (space reserved even when empty), interests to 3.
- **Comboboxes.** Any choice among more than about 8 options is searchable. All three are in `src/components/ui/combobox.tsx`, built on cmdk (`ui/command.tsx`):
  - `Combobox`: pick one. Replaces `<select>` and single-choice menus.
  - `MultiCombobox`: pick many, with the picks shown as chips in the trigger. Replaces "N selected" checkbox menus.
  - `CommandPicker`: search, then act, as in "Add member". Pass extra search terms as `keywords`, such as a member's roles and projects.

  They find an enclosing Dialog automatically and portal into it, and item highlight has no transition. Short fixed sets (year, pronouns, category) stay plain menus.
- **Badges are rare.** A filled pill is only for a control you click (a status that opens a menu) or a row's one most important fact.
  - A state becomes a coloured dot, coloured text, or an icon with a tooltip (Accepted/Rejected, late, no application, announcement status).
  - Metadata becomes plain muted text (roles as one comma line, client, type, "R2").
  - Anything the row, heading or column already says is removed (per-applicant Confirmed/Staged lives once in the row header).
  - PM and admin toggles are the `AdminCrown`. The one pill shape is `rounded-full`.
- **Sliding selections.** One-of-N controls slide their selection (`src/lib/use-sliding-indicator.ts`), at 180ms ease-out-cubic like the header:
  - `Segmented` (`ui/segmented.tsx`): a pill, clipped with `clip-path` so corners never distort. Used for calendar views, slot length, portal type, period status and "View as".
  - `TabStrip` (`ui/tab-strip.tsx`): a 2px underline moved with `translateX`/`scaleX`. Used for admin, email blast, analytics and the scoreboard.
  - Both are proper radiogroup/tablist widgets with arrow keys.
- **Back links.** `BackLink` (`components/back-link.tsx`) mirrors the forward links: the destination's name ("Dashboard", "Manager"), never "Back", with an arrow that nudges on hover.
- **Optional fields.** Forms show what's required; everything optional sits in a `Disclosure` (`ui/disclosure.tsx`, "More options"), which opens with a height animation and starts open when anything inside is already set. Used on portal, project, family, event, announcement and semester forms.
- **Colour picking.** One `ColorPicker` everywhere: a 36px trigger (swatch, hex, chevron) opening a popover with the presets, the native picker, a hex field and "No colour" (hidden when `required`).
- **Loading.** Paint the real shell (title, tabs, toolbars) immediately and put skeletons only where data goes. Start data requests on mount rather than after client-side role checks; the API enforces access.
- **Events are bars, not cards.** Every event (cards, month chips, the week all-day band, agenda, panels, attendance rows) is just its information beside a rounded vertical colour bar: `eventBarColor()` (category colour, else the portal's, else slate; very dark accents lifted). Week time blocks keep a faint 14% tint of their span plus the bar. Category and portal labels use `readableAccentText()`, the accent mixed 30% toward the foreground so it reads on the page in both themes. Each card has `id="event-<id>"`, and clicking a chip scrolls to it.
- **Calendar navigation.** The period label opens a `MonthYearPicker` (year stepper, months, Today, exact date). "+N more" selects the day and scrolls to its list.
- **Announcements** hang off the sticky header as one glass strip on every app page: square top, rounded bottom, each announcement in its colour at 72% over a blur, readable text, the gradient rim.
- **Admin lists: rows first, details lazy.** List routes return light rows (names, counts); expanding a row opens instantly (`animate-expand`) with skeleton lines and fetches that row's details or roster (`/api/admin/*/[id]`).
- **Rosters.** `RosterList` is the one member/role list: name, crown toggle, remove, a search box past 5 rows, scrolling inside its panel. No pills.
- **Access changes ask first.** Roles, member status, PM and admin tiers go through `useConfirm()` (a `ConfirmDialog` naming the person and the change), then apply optimistically. Removing access is red.
- **Pagers are arrows.** Previous/next are chevron icon buttons with aria-labels, never "Previous"/"Next" text.
- **Segmented in grids.** `shape="soft"` (3px corners), `allowDeselect` (click the selected option to clear), per-option coloured indicators, and `selectOnFocus={false}` so arrowing across a grid never writes data (attendance P/A/E).
- **Comboboxes default to the best match.** The first real match is highlighted while you type and Enter picks it; "Add …" sorts last.
- **Portal card.** A 4px accent strip runs down the left edge at rest and wipes across the whole card on hover. This is a named exception to the no-coloured-side-borders rule: the strip is the resting state of the swipe. Card actions live in a ⋯ menu that appears on hover.
- **Scoreboard.** Families and projects both use one ranked-line pattern, `StandingLine`: rank, mark, name, a thin bar scaled to the leader, then points in Geist Mono. There is no podium.
- **Announcement banners.** A flat fill in the admin's chosen colour, with `accentRing` and readable text.
- **Sign-in page.** The wordmark pairs a bold "Open Portal" with a light (300) "Open Project". The left panel is dark in both themes. It shows the three floating logo shapes, with a cursor blob that inverts whatever is under it.
- **Footer.** One quiet line: name, link, copyright, theme toggle.

## Do's and Don'ts

**Do**
- Use status tokens and soft `/15` fills for status. Use identity colours only for identity.
- Group with spacing and tint. When an edge is truly needed, use the faint token border.
- Show edits immediately. Roll back loudly (a toast) and quietly (restore the old state).
- Put explanations behind `InfoHint` and delete self-evident labels.
- Use `tabular-nums` everywhere (it's already the default) and Geist Mono for scores and ranks.

**Don't**
- Use gradients, sheen, or gradient text, anywhere other than the logo.
- Use outlined container boxes, `divide-y` row rules, or borders thicker than 1px.
- Use uppercase eyebrows above headings, or monospace as decoration.
- Use raw Tailwind palette colours (`text-red-500`, `bg-green-600`).
- Use `transition-all`, animate width or height, scale the hovered element, or bounce.
- Show "Saving…" spinners for writes that could be optimistic.
