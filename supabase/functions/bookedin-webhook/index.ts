// Receives BookedIN appointment events from Zapier, logs them to
// bookedin_appointments, and syncs the matching contact in the external
// leadjig_leads database (creating it if no email match), then writes a
// contact_activity entry.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const LEADJIG_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
const LEADJIG_ANON = "sb_publishable_8Vv7urmF3VqUXH3avaxrsg_cfSNKWr1";

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;


type AppointmentStatus = "booked" | "rescheduled" | "cancelled";

function normalizeStatus(s: string): AppointmentStatus | null {
  const v = s.trim().toLowerCase();
  if (["booked", "created", "new", "confirmed"].includes(v)) return "booked";
  if (["rescheduled", "reschedule", "updated"].includes(v)) return "rescheduled";
  if (["cancelled", "canceled", "cancel"].includes(v)) return "cancelled";
  return null;
}

function splitName(full?: string | null): { first: string; last: string } {
  const t = (full || "").trim();
  if (!t) return { first: "", last: "" };
  const parts = t.split(/\s+/);
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// Parse dates that may arrive as ISO or as human-readable strings like
// "Tuesday, Apr 21, 2026 at 10:00 AM". Returns ISO string or null.
function parseFlexibleDate(raw: string): string | null {
  if (!raw) return null;
  const tryDate = (s: string) => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  let iso = tryDate(raw);
  if (iso) return iso;
  // Strip leading weekday "Tuesday, " and replace " at " with " "
  let cleaned = raw.replace(/^[A-Za-z]+,\s*/, "").replace(/\s+at\s+/i, " ");
  iso = tryDate(cleaned);
  if (iso) return iso;
  // Try removing ordinal suffixes (1st, 2nd, 3rd, 4th)
  cleaned = cleaned.replace(/(\d+)(st|nd|rd|th)/gi, "$1");
  iso = tryDate(cleaned);
  return iso;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Public endpoint — no auth checks (Zapier posts directly)

  let payload: Record<string, any>;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Accept flexible field names from Zapier mapping
  const email = String(
    payload.contact_email || payload.email || payload.client_email || ""
  ).trim().toLowerCase();
  const name = String(
    payload.contact_name || payload.name || payload.client_name || ""
  ).trim();
  const phone = String(payload.contact_phone || payload.phone || "").trim();
  const apptDateRaw = String(
    payload.appointment_date || payload.date || payload.start_time || payload.scheduled_at || ""
  ).trim();
  const statusRaw = String(payload.appointment_status || payload.status || payload.event || "").trim();
  const notes = String(payload.notes || payload.note || "").trim() || null;

  if (!email) {
    return new Response(JSON.stringify({ error: "contact_email is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const status = normalizeStatus(statusRaw);
  if (!status) {
    return new Response(JSON.stringify({ error: `unknown appointment_status: ${statusRaw}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apptDateIso = parseFlexibleDate(apptDateRaw);

  const cloud = createClient(CLOUD_URL, CLOUD_SERVICE_ROLE);
  const sb = createClient(LEADJIG_URL, LEADJIG_ANON);

  // 1) Log raw appointment
  const { data: logRow, error: logErr } = await cloud
    .from("bookedin_appointments")
    .insert({
      contact_email: email,
      contact_name: name || null,
      contact_phone: phone || null,
      appointment_date: apptDateIso,
      appointment_status: status,
      notes,
      raw_payload: payload,
    })
    .select("id").single();

  if (logErr) {
    console.error("log insert failed", logErr);
    return new Response(JSON.stringify({ error: `log insert: ${logErr.message}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let leadId: string | null = null;
  let created = false;
  let processError: string | null = null;

  try {
    // 2) Find existing contact by email (case-insensitive)
    const { data: matches, error: findErr } = await sb
      .from("leadjig_leads")
      .select("id, name, email, phone, raw_payload, client_profile")
      .ilike("email", email)
      .limit(1);
    if (findErr) throw new Error(`find lead: ${findErr.message}`);

    const existing = matches?.[0];

    // Map appointment status -> followup status & contact status
    const followupStatus = status === "cancelled" ? "Cancelled" : "Pending";
    const contactStatus = status === "cancelled" ? "Prospect" : "Appointment Set";

    if (existing) {
      leadId = existing.id;
      const cp = (existing.client_profile ?? {}) as Record<string, any>;
      const newCp = {
        ...cp,
        followup_date: apptDateIso ?? cp.followup_date ?? null,
        followup_type: "In Person",
        followup_status: followupStatus,
        followup_auto_send: false,
        followup_sent_at: null,
        appointment_status: status,
        last_bookedin_sync: new Date().toISOString(),
      };
      const updates: Record<string, any> = { client_profile: newCp };
      // Only bump status if not cancelled-revert
      if (status !== "cancelled" || (cp.stage_label ?? cp.status) !== "Client") {
        updates.client_profile = { ...newCp, status: contactStatus };
      }
      const { error: upErr } = await sb
        .from("leadjig_leads")
        .update(updates)
        .eq("id", existing.id);
      if (upErr) throw new Error(`update lead: ${upErr.message}`);
    } else {
      // 3) Create new contact (full: email, name, phone)
      const { first, last } = splitName(name);
      const newRaw: Record<string, any> = {
        first_name: first || null,
        last_name: last || null,
        source: "BookedIN",
      };
      const newCp: Record<string, any> = {
        status: contactStatus,
        followup_date: apptDateIso,
        followup_type: "In Person",
        followup_status: followupStatus,
        followup_auto_send: false,
        appointment_status: status,
        last_bookedin_sync: new Date().toISOString(),
      };
      const { data: ins, error: insErr } = await sb
        .from("leadjig_leads")
        .insert({
          name: name || email,
          email,
          phone: phone || null,
          raw_payload: newRaw,
          client_profile: newCp,
        })
        .select("id").single();
      if (insErr) throw new Error(`create lead: ${insErr.message}`);
      leadId = ins.id;
      created = true;
    }

    // 4) Activity log entry
    if (leadId) {
      await cloud.from("contact_activity").insert({
        lead_id: leadId,
        type: "bookedin_appointment",
        channel: "bookedin",
        status: status,
        body: `Appointment ${status}${apptDateIso ? ` for ${apptDateIso}` : ""}${created ? " (contact auto-created)" : ""}${notes ? ` — ${notes}` : ""}`,
      });
    }
  } catch (e) {
    processError = e instanceof Error ? e.message : String(e);
    console.error("sync failed", processError);
  }

  // Mark log row processed
  await cloud
    .from("bookedin_appointments")
    .update({
      processed_at: new Date().toISOString(),
      process_error: processError,
    })
    .eq("id", logRow.id);

  return new Response(
    JSON.stringify({
      success: !processError,
      log_id: logRow.id,
      lead_id: leadId,
      created,
      error: processError,
    }),
    { status: processError ? 500 : 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
