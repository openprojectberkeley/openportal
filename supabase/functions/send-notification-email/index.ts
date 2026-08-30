// Sends an email for one important in-app notification via SMTP2GO.
//
// Invoked by the `trg_notification_email` Postgres trigger (0037) through
// pg_net, with body { notification_id } and header x-webhook-secret. The trigger
// has already filtered to the emailable types, so this function does not
// re-filter type — it authenticates, loads the row, honors the recipient's
// opt-out, sends, and stamps notifications.email_sent_at exactly once.
//
// Env (set via `supabase secrets set` or the dashboard):
//   WEBHOOK_SECRET   shared secret, must equal Vault `notification_email_secret`
//   SMTP2GO_API_KEY  SMTP2GO API key with email-send permission
//   EMAIL_FROM       verified sender; defaults to
//                    "Open Portal <noreply@openprojectberkeley.com>"
//   APP_URL          optional; base URL used for the "Open Portal" link in emails
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  injected by the platform
//
// Deployed with --no-verify-jwt: auth is the shared secret below, not a JWT.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { buildInvite, type IcsMethod } from "./ics.ts";

const SMTP2GO_ENDPOINT = "https://api.smtp2go.com/v3/email/send";

const ORGANIZER_NAME = "Open Portal";
const ORGANIZER_EMAIL = "noreply@openprojectberkeley.com";
const EVENT_SUMMARY = "Coffee chat — Open Project";

// Types that carry a schedulable meeting, and how each maps to a calendar action.
const CANCEL_TYPES = new Set(["chat_cancelled_by_applicant", "chat_cancelled_by_host"]);
const CALENDAR_TYPES = new Set([
  "chat_booked",
  "location_added",
  "location_updated",
  "chat_cancelled_by_applicant",
  "chat_cancelled_by_host",
]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Google Calendar "add event" template URL (mirrors src/lib/gcal.ts, inlined so
// the function has no Next-bundle dependency). Times are UTC, unambiguous.
function gcalUrl(opts: { start: Date; end: Date; title: string; details?: string; location?: string }): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return (
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(opts.title)}` +
    `&dates=${fmt(opts.start)}/${fmt(opts.end)}` +
    (opts.details ? `&details=${encodeURIComponent(opts.details)}` : "") +
    (opts.location ? `&location=${encodeURIComponent(opts.location)}` : "")
  );
}

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  coffee_chat_id: string | null;
  meeting_time: string | null;
  created_at: string;
  email_sent_at: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Authenticate the caller (constant-ish check; secret is not user-supplied).
  const expected = Deno.env.get("WEBHOOK_SECRET");
  if (!expected || req.headers.get("x-webhook-secret") !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  let notificationId: string | undefined;
  try {
    ({ notification_id: notificationId } = await req.json());
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!notificationId) {
    return new Response("Missing notification_id", { status: 400 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Load the notification. Guard email_sent_at so replays never double-send.
  const { data: notif, error: notifErr } = await admin
    .from("notifications")
    .select("id, user_id, type, title, body, coffee_chat_id, meeting_time, created_at, email_sent_at")
    .eq("id", notificationId)
    .maybeSingle<NotificationRow>();

  if (notifErr) return new Response(notifErr.message, { status: 500 });
  if (!notif) return new Response("Notification not found", { status: 404 });
  if (notif.email_sent_at) return new Response("Already sent", { status: 200 });

  // Recipient email + opt-out live on the members profile row.
  const { data: member } = await admin
    .from("members")
    .select("email, email_notifications, preferred_firstname")
    .eq("user_id", notif.user_id)
    .maybeSingle<{ email: string | null; email_notifications: boolean; preferred_firstname: string | null }>();

  if (!member?.email) return new Response("No recipient email", { status: 200 });
  if (member.email_notifications === false) {
    return new Response("Recipient opted out", { status: 200 });
  }

  // Override with the EMAIL_FROM secret to change the display name / address;
  // must be on a domain verified in SMTP2GO or the send is rejected.
  const from = Deno.env.get("EMAIL_FROM") ?? "Open Portal <noreply@openprojectberkeley.com>";
  const apiKey = Deno.env.get("SMTP2GO_API_KEY");
  if (!apiKey) {
    return new Response("Email not configured", { status: 500 });
  }

  const appUrl = Deno.env.get("APP_URL");
  const greeting = member.preferred_firstname ? `Hi ${escapeHtml(member.preferred_firstname)},` : "Hi,";
  const bodyText = notif.body ?? "";

  // Build a calendar action for the schedulable coffee-chat types. Everything is
  // derived from the notification row (meeting_time is stored there); the seat is
  // only an enrichment for duration/location, so a missing/altered seat degrades
  // gracefully to a 30-min event with no location rather than skipping the invite.
  let icsInvite: string | null = null;
  let icsMethod: IcsMethod = "REQUEST";
  let gcalHtml = "";
  if (CALENDAR_TYPES.has(notif.type) && notif.coffee_chat_id && notif.meeting_time) {
    const { data: seat } = await admin
      .from("coffee_chats")
      .select("duration_minutes, location")
      .eq("id", notif.coffee_chat_id)
      .maybeSingle<{ duration_minutes: number | null; location: string | null }>();

    const start = new Date(notif.meeting_time);
    const end = new Date(start.getTime() + (seat?.duration_minutes ?? 30) * 60 * 1000);
    const location = seat?.location ?? null;
    icsMethod = CANCEL_TYPES.has(notif.type) ? "CANCEL" : "REQUEST";

    icsInvite = buildInvite({
      method: icsMethod,
      uid: `${notif.coffee_chat_id}@openportal`,
      // Monotonic per notification, so updates/cancels outrank the original.
      sequence: Math.floor(Date.parse(notif.created_at) / 1000),
      start,
      end,
      summary: EVENT_SUMMARY,
      description: bodyText || null,
      location,
      organizerName: ORGANIZER_NAME,
      organizerEmail: ORGANIZER_EMAIL,
      attendeeEmail: member.email,
    });

    // Explicit "Add to Google Calendar" fallback — only for add/update, not cancel.
    if (icsMethod === "REQUEST") {
      const url = gcalUrl({ start, end, title: EVENT_SUMMARY, details: bodyText || undefined, location: location ?? undefined });
      gcalHtml = `<p style="margin:20px 0 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600">Add to Google Calendar</a></p>`;
    }
  }

  const linkHtml = appUrl
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(appUrl)}" style="color:#2563eb">Open Portal</a></p>`
    : "";

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">
  <p style="margin:0 0 12px">${greeting}</p>
  <p style="margin:0 0 8px;font-weight:600">${escapeHtml(notif.title)}</p>
  <p style="margin:0">${escapeHtml(bodyText)}</p>
  ${gcalHtml}
  ${linkHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0 12px">
  <p style="margin:0;font-size:12px;color:#888">You're receiving this because you have Open Portal email notifications on. You can turn them off in your profile.</p>
</div>`;

  const text = `${greeting}\n\n${notif.title}\n${bodyText}${appUrl ? `\n\nOpen Portal: ${appUrl}` : ""}`;

  // SMTP2GO v3 attachments: base64 `fileblob`, `filename`, `mimetype`. The
  // text/calendar mimetype (with the matching METHOD) is what makes mail clients
  // treat the .ics as an invite rather than a generic file.
  const attachments = icsInvite
    ? [{
      filename: "invite.ics",
      fileblob: encodeBase64(new TextEncoder().encode(icsInvite)),
      mimetype: `text/calendar; method=${icsMethod}; name=invite.ics`,
    }]
    : undefined;

  const res = await fetch(SMTP2GO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Smtp2go-Api-Key": apiKey,
    },
    body: JSON.stringify({
      sender: from,
      to: [member.email],
      subject: notif.title,
      html_body: html,
      text_body: text,
      ...(attachments ? { attachments } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("SMTP2GO send failed", res.status, detail);
    return new Response("Send failed", { status: 502 });
  }

  // Stamp only after a successful send so a failure leaves it retryable.
  await admin
    .from("notifications")
    .update({ email_sent_at: new Date().toISOString() })
    .eq("id", notif.id);

  return new Response("OK", { status: 200 });
});
