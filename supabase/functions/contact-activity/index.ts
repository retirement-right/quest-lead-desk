// Read/write contact_activity on behalf of a logged-in staff member.
//
// Staff sign in to LeadJig, so the browser has NO Cloud session — every direct
// PostgREST call from the app runs as `anon` and is (correctly) rejected by the
// contact_activity RLS policies, which grant only `authenticated`. This function
// validates the LeadJig staff JWT in code (same pattern as lead-documents) and
// then performs the read/write with the Cloud service role. Policies stay as-is.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jsonResponse, requireStaffAuth } from "../_shared/followup-auth.ts";

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only the activity kinds the CRM UI is allowed to write.
const ALLOWED_TYPES = new Set(["manual_send", "status_change", "note"]);
const ALLOWED_CHANNELS = new Set(["email", "sms", "status", "note"]);

const clip = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const action = String(body.action ?? "list");
  const leadId = String(body.leadId ?? "").trim();
  if (!UUID_RE.test(leadId)) return jsonResponse({ error: "leadId must be a uuid" }, 400);

  const admin = createClient(CLOUD_URL, CLOUD_SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    if (action === "list") {
      const limitRaw = Number(body.limit ?? 50);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
      const { data, error } = await admin
        .from("contact_activity")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return jsonResponse({ activity: data ?? [] });
    }

    if (action === "log") {
      const type = String(body.type ?? "").trim();
      const channel = String(body.channel ?? "").trim();
      if (!ALLOWED_TYPES.has(type)) return jsonResponse({ error: "Unsupported type" }, 400);
      if (!ALLOWED_CHANNELS.has(channel)) return jsonResponse({ error: "Unsupported channel" }, 400);

      const status = clip(body.status, 40) ?? "sent";
      const { error } = await admin.from("contact_activity").insert({
        lead_id: leadId,
        type,
        channel,
        direction: "outbound",
        recipient: clip(body.recipient, 320),
        body: clip(body.body, 4000),
        status,
        error: clip(body.error, 1000),
        sender: auth.email ?? null,
      });
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : "contact-activity failed";
    console.error("contact-activity error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
