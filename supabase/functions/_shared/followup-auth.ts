import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const LEADJIG_URL = "https://uoneplysuvmaygbrbswd.supabase.co";

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Validates LeadJig staff JWT (CRM login). Rejects anon/public calls. */
export async function requireStaffAuth(req: Request): Promise<{ userId: string } | Response> {
  const serviceKey = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return jsonResponse({ error: "Server not configured" }, 500);
  }
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const jwt = auth.slice(7).trim();
  if (!jwt) return jsonResponse({ error: "Unauthorized" }, 401);

  const admin = createClient(LEADJIG_URL, serviceKey);
  const { data: { user }, error } = await admin.auth.getUser(jwt);
  if (error || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return { userId: user.id };
}

/** Cron/scheduler only — not callable from the browser. */
export function requireCronSecret(req: Request): Response | null {
  const secret = Deno.env.get("PROCESS_FOLLOWUPS_SECRET");
  if (!secret) {
    return jsonResponse({ error: "Scheduler secret not configured" }, 500);
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (provided !== secret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return null;
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  let to = digits;
  if (!to.startsWith("+")) {
    const onlyNums = to.replace(/\D/g, "");
    if (onlyNums.length === 10) to = `+1${onlyNums}`;
    else if (onlyNums.length === 11 && onlyNums.startsWith("1")) to = `+${onlyNums}`;
    else to = `+${onlyNums}`;
  }
  return /^\+\d{10,15}$/.test(to) ? to : null;
}

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

export async function loadLeadRecipient(
  leadId: string,
  channel: "email" | "sms",
): Promise<{ recipient: string; firstName: string } | Response> {
  const serviceKey = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return jsonResponse({ error: "Server not configured" }, 500);
  }
  const admin = createClient(LEADJIG_URL, serviceKey);
  const { data: lead, error } = await admin
    .from("leadjig_leads")
    .select("id, name, email, phone, do_not_email, raw_payload")
    .eq("id", leadId)
    .maybeSingle();

  if (error || !lead) {
    return jsonResponse({ error: "Lead not found" }, 404);
  }

  const rp = (lead.raw_payload ?? {}) as Record<string, unknown>;
  const firstName =
    String(rp.first_name || (lead.name ? String(lead.name).split(" ")[0] : "") || "").trim() ||
    "there";

  if (channel === "email") {
    if (lead.do_not_email) {
      return jsonResponse({ error: "Contact opted out of email" }, 400);
    }
    const recipient = normalizeEmail(String(lead.email ?? ""));
    if (!recipient) return jsonResponse({ error: "Lead has no valid email" }, 400);
    return { recipient, firstName };
  }

  const recipient = normalizePhone(String(lead.phone ?? ""));
  if (!recipient) return jsonResponse({ error: "Lead has no valid phone" }, 400);
  return { recipient, firstName };
}
