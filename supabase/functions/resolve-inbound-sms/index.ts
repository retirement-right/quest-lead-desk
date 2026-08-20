// Attach queued inbound SMS replies to CRM contacts.
//
// LeadJig reads require a staff session, which the Twilio webhook does not
// have, so twilio-inbound-sms queues unknown senders in inbound_sms_unmatched.
// The CRM (where a staff session exists) does the phone lookup and posts the
// resulting lead_id here; this function writes the activity row with the Cloud
// service role. No LeadJig service key is involved.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jsonResponse, requireStaffAuth } from "../_shared/followup-auth.ts";

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  const admin = createClient(CLOUD_URL, CLOUD_SERVICE_ROLE, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action ?? "list");

  try {
    if (action === "list") {
      const limitRaw = Number(body.limit ?? 200);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
      const { data, error } = await admin
        .from("inbound_sms_unmatched")
        .select("id, message_sid, from_number, to_number, body, num_media, provider_status, metadata, received_at")
        .is("resolved_lead_id", null)
        .order("received_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return jsonResponse({ pending: data ?? [] });
    }

    if (action === "resolve") {
      const raw = Array.isArray(body.matches) ? body.matches : [];
      const matches: { id: string; lead_id: string }[] = [];
      for (const m of raw) {
        const id = String((m as any)?.id ?? "").trim();
        const leadId = String((m as any)?.lead_id ?? "").trim();
        if (!UUID_RE.test(id) || !UUID_RE.test(leadId)) {
          return jsonResponse({ error: "matches[] entries need uuid id and lead_id" }, 400);
        }
        matches.push({ id, lead_id: leadId });
      }
      if (matches.length === 0) return jsonResponse({ resolved: 0, results: [] });
      if (matches.length > 200) return jsonResponse({ error: "Too many matches (max 200)" }, 400);

      const results: Record<string, unknown>[] = [];
      let resolved = 0;

      for (const m of matches) {
        const { data: row, error: fetchErr } = await admin
          .from("inbound_sms_unmatched")
          .select("id, message_sid, from_number, to_number, body, num_media, provider_status, metadata, resolved_lead_id")
          .eq("id", m.id)
          .maybeSingle();
        if (fetchErr) {
          results.push({ id: m.id, error: fetchErr.message });
          continue;
        }
        if (!row) {
          results.push({ id: m.id, error: "not found" });
          continue;
        }
        if (row.resolved_lead_id) {
          results.push({ id: m.id, skipped: "already resolved" });
          continue;
        }

        const { error: insErr } = await admin.from("contact_activity").insert({
          lead_id: m.lead_id,
          type: "sms_inbound",
          channel: "sms",
          direction: "inbound",
          recipient: row.to_number,
          sender: row.from_number,
          to_number: row.to_number,
          message_sid: row.message_sid,
          provider_status: row.provider_status,
          body: row.body || ((row.num_media ?? 0) > 0 ? `(${row.num_media} media attachment(s))` : ""),
          status: "received",
          metadata: row.metadata,
        });
        // 23505 = already inserted by an earlier pass; treat as success.
        if (insErr && insErr.code !== "23505") {
          results.push({ id: m.id, error: insErr.message });
          continue;
        }

        const { error: updErr } = await admin
          .from("inbound_sms_unmatched")
          .update({ resolved_lead_id: m.lead_id, resolved_at: new Date().toISOString() })
          .eq("id", m.id)
          .is("resolved_lead_id", null);
        if (updErr) {
          results.push({ id: m.id, error: updErr.message });
          continue;
        }

        resolved += 1;
        results.push({ id: m.id, lead_id: m.lead_id, resolved: true });
      }

      return jsonResponse({ resolved, results });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : "resolve-inbound-sms failed";
    console.error("resolve-inbound-sms error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
