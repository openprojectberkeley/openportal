// Sends a "contact tech support" email drafted from the in-app help button.
//
// Invoked directly from the browser via supabase.functions.invoke(), so unlike
// send-notification-email this function is deployed WITH JWT verification and
// answers CORS preflight. The signed-in caller is the sender: their identity is
// read from the verified JWT (never the request body), they are cc'd on the
// message, and Reply-To points back at them. Recipients are every member holding
// the "VP Tech" role, resolved with the service role.
//
// Env (project-wide secrets, shared with send-notification-email):
//   SMTP2GO_API_KEY  SMTP2GO API key with email-send permission
//   EMAIL_FROM       verified sender; defaults to
//                    "Open Portal <noreply@openprojectberkeley.com>"
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  injected by the platform
//
// Deploy: `supabase functions deploy send-support-email` (JWT-verified default).

import { createClient } from "jsr:@supabase/supabase-js@2";

const SMTP2GO_ENDPOINT = "https://api.smtp2go.com/v3/email/send";

// Must match the role_name value in the roles table (mirrors VP_TECH_ROLE_NAME
// in src/lib/roles.ts).
const VP_TECH_ROLE_NAME = "VP Tech";

const MAX_MESSAGE_LENGTH = 5000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Sender identity comes from the verified JWT, not the request body.
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !user?.email) return json({ error: "Unauthorized" }, 401);
  const senderEmail = user.email;

  // Message body.
  let message: unknown;
  try {
    ({ message } = await req.json());
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    return json({ error: "Message is required" }, 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: "Message is too long" }, 400);
  }
  const trimmed = message.trim();

  // A friendly sender name for the subject/body (falls back to the email).
  const { data: senderMember } = await admin
    .from("members")
    .select("preferred_firstname, lastname")
    .eq("user_id", user.id)
    .maybeSingle<{ preferred_firstname: string | null; lastname: string | null }>();
  const senderName =
    [senderMember?.preferred_firstname, senderMember?.lastname].filter(Boolean).join(" ").trim() ||
    (user.user_metadata?.name as string | undefined) ||
    (user.user_metadata?.full_name as string | undefined) ||
    senderEmail;

  // Resolve VP Tech recipient emails (service role bypasses RLS).
  const { data: role } = await admin
    .from("roles")
    .select("id")
    .eq("role_name", VP_TECH_ROLE_NAME)
    .maybeSingle<{ id: number | string }>();
  if (!role) return json({ error: "Tech support role is not configured" }, 500);

  const { data: roleMembers } = await admin
    .from("members_roles")
    .select("user_id")
    .eq("role_id", role.id);
  const userIds = (roleMembers ?? []).map((r) => (r as { user_id: string }).user_id);

  let recipients: string[] = [];
  if (userIds.length > 0) {
    const { data: mems } = await admin
      .from("members")
      .select("email")
      .in("user_id", userIds);
    recipients = (mems ?? [])
      .map((m) => (m as { email: string | null }).email)
      .filter((e): e is string => !!e);
  }
  if (recipients.length === 0) {
    return json({ error: "No tech support recipients found" }, 500);
  }

  const from = Deno.env.get("EMAIL_FROM") ?? "Open Portal <noreply@openprojectberkeley.com>";
  const apiKey = Deno.env.get("SMTP2GO_API_KEY");
  if (!apiKey) return json({ error: "Email not configured" }, 500);

  const subject = `Tech support request from ${senderName}`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">
  <p style="margin:0 0 8px;font-weight:600">New tech support request</p>
  <p style="margin:0 0 4px"><strong>From:</strong> ${escapeHtml(senderName)} (${escapeHtml(senderEmail)})</p>
  <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
  <p style="margin:0;white-space:pre-wrap">${escapeHtml(trimmed)}</p>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0 12px">
  <p style="margin:0;font-size:12px;color:#888">Sent from the Open Portal help button. Reply to reach ${escapeHtml(senderEmail)}.</p>
</div>`;
  const text = `New tech support request\n\nFrom: ${senderName} (${senderEmail})\n\n${trimmed}`;

  const res = await fetch(SMTP2GO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Smtp2go-Api-Key": apiKey,
    },
    body: JSON.stringify({
      sender: from,
      to: recipients,
      cc: [senderEmail],
      reply_to: senderEmail,
      subject,
      html_body: html,
      text_body: text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("SMTP2GO send failed", res.status, detail);
    return json({ error: "Send failed" }, 502);
  }

  return json({ ok: true }, 200);
});
