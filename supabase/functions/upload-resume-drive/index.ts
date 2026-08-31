// Uploads an applicant's resume to a shared Google Drive folder (the team's
// native resume reviewer reads that folder), then records a link on the
// applicant's `applications` row so the in-app reviewer modal can open it.
//
// Invoked from the browser via supabase.functions.invoke(), so — like
// send-support-email — it's JWT-verified and answers CORS preflight. The caller's
// identity comes from the verified JWT (never the body); the Drive filename is
// derived server-side from their member record as `Lastname_Firstname_email.ext`.
//
//   POST (multipart/form-data): fields `file` (the resume) + `period_id`  -> upload
//   POST (application/json): { action: "delete", period_id }              -> remove
//
// Env (set via `supabase secrets set`):
//   GOOGLE_SA_CLIENT_EMAIL   service-account email
//   GOOGLE_SA_PRIVATE_KEY    service-account PKCS8 private key (PEM; \n escaped ok)
//   GDRIVE_RESUME_FOLDER_ID  target folder id — MUST be in a Shared Drive with
//                            the service account added as a member (a My Drive
//                            folder fails: SA-owned files have a 0-byte quota)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  injected by the platform
//
// Deploy: `supabase functions deploy upload-resume-drive` (JWT-verified default).

import { createClient } from "jsr:@supabase/supabase-js@2";

const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXT = ["pdf", "doc", "docx"];

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

// ---- Google service-account access token (RS256 JWT bearer grant) ----------
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToBytes(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getGoogleAccessToken(): Promise<string> {
  const clientEmail = Deno.env.get("GOOGLE_SA_CLIENT_EMAIL");
  const privateKeyPem = Deno.env.get("GOOGLE_SA_PRIVATE_KEY")?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKeyPem) throw new Error("Google service account is not configured");

  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned =
    enc({ alg: "RS256", typ: "JWT" }) +
    "." +
    enc({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/drive",
      aud: GOOGLE_TOKEN,
      iat: now,
      exp: now + 3600,
    });

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

async function driveDelete(token: string, fileId: string): Promise<void> {
  await fetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {}); // best-effort
}

function sanitize(s: string): string {
  return s.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Identity from the verified JWT.
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !user?.email) return json({ error: "Unauthorized" }, 401);

  const contentType = req.headers.get("content-type") ?? "";
  const isDelete = contentType.includes("application/json");

  // Parse input (delete = JSON body, upload = multipart form).
  let periodId = "";
  let file: File | null = null;
  if (isDelete) {
    try {
      const body = await req.json();
      periodId = String(body.period_id ?? "");
    } catch {
      return json({ error: "Bad request" }, 400);
    }
  } else {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json({ error: "Bad request" }, 400);
    }
    periodId = String(form.get("period_id") ?? "");
    const f = form.get("file");
    if (f instanceof File) file = f;
  }
  if (!periodId) return json({ error: "period_id is required" }, 400);

  // Find (or create) the caller's application row for this period.
  let appId: string | null = null;
  let existingFileId: string | null = null;
  {
    const { data: app } = await admin
      .from("applications")
      .select("id, resume_drive_file_id")
      .eq("applicant_id", user.id)
      .eq("period_id", periodId)
      .maybeSingle<{ id: string; resume_drive_file_id: string | null }>();
    if (app) { appId = app.id; existingFileId = app.resume_drive_file_id; }
  }

  let googleToken: string;
  try {
    googleToken = await getGoogleAccessToken();
  } catch (e) {
    console.error(e);
    return json({ error: "Resume storage is not configured" }, 500);
  }

  // ---- Delete ----
  if (isDelete) {
    if (existingFileId) await driveDelete(googleToken, existingFileId);
    if (appId) {
      await admin
        .from("applications")
        .update({ resume_drive_file_id: null, resume_drive_url: null, resume_filename: null, resume_uploaded_at: null })
        .eq("id", appId);
    }
    return json({ ok: true }, 200);
  }

  // ---- Upload ----
  if (!file) return json({ error: "file is required" }, 400);
  if (file.size > MAX_BYTES) return json({ error: "That file is too large (max 8 MB)." }, 400);
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return json({ error: "Please upload a PDF or Word document." }, 400);

  // Ensure the application row exists (service role bypasses RLS).
  if (!appId) {
    const { data: created, error: insErr } = await admin
      .from("applications")
      .insert({ applicant_id: user.id, period_id: periodId })
      .select("id")
      .single<{ id: string }>();
    if (insErr || !created) return json({ error: "Couldn't start your application." }, 500);
    appId = created.id;
  }

  // Server-derived filename: Lastname_Firstname_email.ext (can't be spoofed).
  const { data: member } = await admin
    .from("members")
    .select("preferred_firstname, lastname")
    .eq("user_id", user.id)
    .maybeSingle<{ preferred_firstname: string | null; lastname: string | null }>();
  const first = member?.preferred_firstname?.trim() || "";
  const last = member?.lastname?.trim() || "";
  const base = [last, first, user.email].filter(Boolean).join("_");
  const driveName = sanitize(base ? `${base}.${ext}` : `${user.email}.${ext}`);

  // Replace any previous upload for this application.
  if (existingFileId) await driveDelete(googleToken, existingFileId);

  const folderId = Deno.env.get("GDRIVE_RESUME_FOLDER_ID");
  if (!folderId) return json({ error: "Resume folder is not configured" }, 500);

  const boundary = `rb_${crypto.randomUUID()}`;
  const metadata = { name: driveName, parents: [folderId] };
  const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`;
  const post = `\r\n--${boundary}--`;
  const multipart = new Blob([pre, await file.arrayBuffer(), post]);

  const uploadRes = await fetch(DRIVE_UPLOAD, {
    method: "POST",
    headers: { Authorization: `Bearer ${googleToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  const uploaded = await uploadRes.json();
  if (!uploadRes.ok) {
    console.error("Drive upload failed", uploadRes.status, uploaded);
    return json({ error: "Upload to Drive failed" }, 502);
  }

  const url = (uploaded.webViewLink as string | undefined) ?? `${DRIVE_FILES}/${uploaded.id}`;
  await admin
    .from("applications")
    .update({
      resume_drive_file_id: uploaded.id,
      resume_drive_url: url,
      resume_filename: file.name,
      resume_uploaded_at: new Date().toISOString(),
    })
    .eq("id", appId);

  return json({ fileId: uploaded.id, url, filename: file.name }, 200);
});
