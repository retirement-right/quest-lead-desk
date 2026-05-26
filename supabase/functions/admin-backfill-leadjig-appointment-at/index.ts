// One-shot admin backfill: copy appointment_date from bookedin_appointments
// into leadjig_leads.appointment_at for a given list of emails.
// Requires a LeadJig staff session (CRM login) to invoke.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jsonResponse, requireStaffAuth } from "../_shared/followup-auth.ts";

const LEADJIG_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
const LEADJIG_SERVICE_ROLE_KEY = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY")!;
const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // one-shot admin endpoint; will be deleted after backfill


  let body: { emails?: string[] };
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
  const emails = (body.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return jsonResponse({ error: "emails[] required" }, 400);

  const cloud = createClient(CLOUD_URL, CLOUD_SERVICE_ROLE);
  const leadjig = createClient(LEADJIG_URL, LEADJIG_SERVICE_ROLE_KEY);

  const results: Record<string, unknown>[] = [];

  for (const email of emails) {
    const { data: rows, error } = await cloud
      .from("bookedin_appointments")
      .select("appointment_date, contact_name, contact_phone")
      .eq("contact_email", email)
      .eq("appointment_status", "booked")
      .not("appointment_date", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) { results.push({ email, error: error.message }); continue; }
    const row = rows?.[0];
    if (!row) { results.push({ email, error: "no bookedin row with appointment_date" }); continue; }

    const { data: leads, error: lErr } = await leadjig
      .from("leadjig_leads")
      .select("id, name, appointment_at")
      .eq("email", email);

    if (lErr) { results.push({ email, error: `leadjig lookup: ${lErr.message}` }); continue; }
    if (!leads?.length) { results.push({ email, error: "no leadjig lead found" }); continue; }

    const updates: Record<string, unknown>[] = [];
    for (const lead of leads) {
      const patch: Record<string, unknown> = { appointment_at: row.appointment_date };
      if (!lead.name && row.contact_name) patch.name = row.contact_name;
      const { error: uErr } = await leadjig
        .from("leadjig_leads")
        .update(patch)
        .eq("id", lead.id);
      updates.push({ id: lead.id, patched: patch, error: uErr?.message ?? null });
    }
    results.push({ email, appointment_at: row.appointment_date, updates });
  }

  return jsonResponse({ ok: true, results });
});
