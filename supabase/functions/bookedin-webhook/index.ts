// Receives BookedIN appointment events from Zapier, logs them to
// bookedin_appointments, and forwards the update to the Retirement-Right
// proxy edge function (which owns writes to leadjig_leads).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const LEADJIG_PROXY_URL =
  "https://uoneplysuvmaygbrbswd.supabase.co/functions/v1/leadjig-update-from-bookedin";
const LEADJIG_SHARED_SECRET = Deno.env.get("LEADJIG_SHARED_SECRET")!;

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
  let cleaned = raw.replace(/^[A-Za-z]+,\s*/, "").replace(/\s+at\s+/i, " ");
  iso = tryDate(cleaned);
  if (iso) return iso;
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

  const email = String(
    payload.contact_email || payload.email || payload.client_email || ""
  ).trim().toLowerCase();
  const firstName = String(
    payload.first_name || payload.contact_first_name || payload.client_first_name || ""
  ).trim();
  const lastName = String(
    payload.last_name || payload.contact_last_name || payload.client_last_name || ""
  ).trim();
  const combinedName = String(
    payload.contact_name || payload.name || payload.client_name || ""
  ).trim();
  const name = combinedName || [firstName, lastName].filter(Boolean).join(" ").trim();
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

  let processError: string | null = null;
  let proxyStatus: number | null = null;
  let proxyBody: unknown = null;
  let skippedReason: string | null = null;

  // Don't forward cancellation events for unknown contacts with no name —
  // otherwise the proxy creates a blank-named "Cancelled" record. We still
  // keep the raw entry in bookedin_appointments for audit.
  const skipForward = status === "cancelled" && !name;

  if (skipForward) {
    skippedReason = "cancelled event with no contact name; not forwarded";
  }

  try {
    if (skipForward) throw new Error("__skip__");
    const lifecycleStage =
      status === "cancelled" ? "cancelled" : "consultation_booked";
    const noteText =
      status === "cancelled"
        ? "Cancelled via BookedIN"
        : status === "rescheduled"
        ? "Rescheduled via BookedIN"
        : "Booked via BookedIN";
    const body = {
      email,
      contact_name: name || null,
      contact_phone: phone || null,
      lifecycle_stage: lifecycleStage,
      appointment_at: apptDateIso,
      booked_at: new Date().toISOString(),
      notes: noteText,
    };

    const resp = await fetch(LEADJIG_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-shared-secret": LEADJIG_SHARED_SECRET,
      },
      body: JSON.stringify(body),
    });
    proxyStatus = resp.status;
    const text = await resp.text();
    try { proxyBody = JSON.parse(text); } catch { proxyBody = text; }
    if (!resp.ok) {
      throw new Error(`proxy ${resp.status}: ${text}`);
    }
  } catch (e) {
    if (skipForward) {
      // intentional skip — not a real error
    } else {
      processError = e instanceof Error ? e.message : String(e);
      console.error("proxy call failed", processError);
    }
  }

  await cloud
    .from("bookedin_appointments")
    .update({
      processed_at: new Date().toISOString(),
      process_error: processError ?? skippedReason,
    })
    .eq("id", logRow.id);

  return new Response(
    JSON.stringify({
      success: !processError,
      skipped: skippedReason,
      log_id: logRow.id,
      proxy_status: proxyStatus,
      proxy_response: proxyBody,
      error: processError,
    }),
    { status: processError ? 502 : 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
