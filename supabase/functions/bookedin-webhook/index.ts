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
const WEBHOOK_SECRET = Deno.env.get("BOOKEDIN_WEBHOOK_SECRET")!;

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
// When the input has NO timezone marker (no trailing Z or ±HH:MM), the
// time is interpreted as Arizona time (UTC-7, no DST observed) — that's
// how BookedIN emits human-readable times for this account, and parsing
// them as UTC was the cause of the recurring "3:00 AM" bug.
function parseFlexibleDate(raw: string): string | null {
  if (!raw) return null;
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(raw.trim());
  const withArizonaTz = (s: string) => (hasTz ? s : `${s} GMT-0700`);

  const tryDate = (s: string) => {
    const d = new Date(withArizonaTz(s));
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

// Proxy errors that are benign for cancellations — when a contact cancels
// we don't actually need the attendee record updated, so a proxy failure
// on that specific step shouldn't flag the sync as failed.
function isBenignCancelledError(status: AppointmentStatus, err: string): boolean {
  if (status !== "cancelled") return false;
  return /failed to update attendees/i.test(err) ||
         /column attendees\.\w+ does not exist/i.test(err);
}

function isProcessedOk(processError: string | null): boolean {
  if (!processError) return true;
  if (processError === "cancelled event with no contact name; not forwarded") return true;
  if (processError.startsWith("cancelled event with no matching CRM appointment")) return true;
  if (processError.startsWith("skipped (cancelled, attendee update): ")) return true;
  return false;
}

// For cancellations: find the prior booked/rescheduled BookedIN appointment for
// the same contact email so we can cancel THAT appointment instead of creating a
// new contact/appointment. Prefers an exact appointment_date match, then the
// closest appointment in time, then the most recent one.
async function findPriorAppointment(
  cloud: ReturnType<typeof createClient>,
  email: string,
  apptDateIso: string | null,
) {
  const { data, error } = await cloud
    .from("bookedin_appointments")
    .select("id, contact_email, contact_name, contact_phone, appointment_date, appointment_status, created_at")
    .eq("contact_email", email)
    .in("appointment_status", ["booked", "rescheduled"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("prior appointment lookup failed", error);
    return null;
  }
  const rows = (data ?? []) as Array<Record<string, any>>;
  if (rows.length === 0) return null;

  if (apptDateIso) {
    const exact = rows.find((r) => r.appointment_date === apptDateIso);
    if (exact) return { row: exact, matchType: "email+exact_time" as const };
    const target = new Date(apptDateIso).getTime();
    const dated = rows.filter((r) => !!r.appointment_date);
    if (dated.length) {
      dated.sort(
        (a, b) =>
          Math.abs(new Date(a.appointment_date).getTime() - target) -
          Math.abs(new Date(b.appointment_date).getTime() - target),
      );
      return { row: dated[0], matchType: "email+closest_time" as const };
    }
  }
  return { row: rows[0], matchType: "email+most_recent" as const };
}

// Cancellation-only fallback: the BookedIN email had no client name AND no
// client email, but did include the exact appointment date/time. Look for
// BookedIN-sourced appointments (this table only ever holds BookedIN events —
// manually entered CRM appointments are never stored here, so time-only
// matching can't touch them) at that exact instant. Only a single unambiguous
// match is actionable.
async function findByExactTimeOnly(
  cloud: ReturnType<typeof createClient>,
  apptDateIso: string,
) {
  const { data, error } = await cloud
    .from("bookedin_appointments")
    .select("id, contact_email, contact_name, contact_phone, appointment_date, appointment_status, created_at")
    .eq("appointment_date", apptDateIso)
    .in("appointment_status", ["booked", "rescheduled"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("exact-time lookup failed", error);
    return { rows: [] as Array<Record<string, any>>, error: error.message };
  }
  return { rows: (data ?? []) as Array<Record<string, any>>, error: null };
}


async function findDuplicateLog(
  cloud: ReturnType<typeof createClient>,
  email: string,
  status: AppointmentStatus,
  apptDateIso: string | null,
) {
  let q = cloud
    .from("bookedin_appointments")
    .select("id, processed_at, process_error")
    .eq("contact_email", email)
    .eq("appointment_status", status);
  q = apptDateIso ? q.eq("appointment_date", apptDateIso) : q.is("appointment_date", null);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) console.error("dedupe lookup failed", error);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Webhook secret not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const providedSecret = req.headers.get("x-webhook-secret") ?? "";
  if (providedSecret !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: Record<string, any>;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let email = String(
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
    payload.appointment_iso || payload.appointment_at || payload.appointment_date || payload.date || payload.start_time || payload.scheduled_at || ""
  ).trim();
  const statusRaw = String(payload.appointment_status || payload.status || payload.event || "").trim();
  const notes = String(payload.notes || payload.note || "").trim() || null;

  const status = normalizeStatus(statusRaw);
  if (!status) {
    return new Response(JSON.stringify({ error: `unknown appointment_status: ${statusRaw}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apptDateIso = parseFlexibleDate(apptDateRaw);

  const cloud = createClient(CLOUD_URL, CLOUD_SERVICE_ROLE);

  // Cancellation with no client email (and possibly no name): resolve the
  // contact strictly by an exact appointment time match against prior BookedIN
  // appointments. Booked/rescheduled handling is untouched — those still
  // require contact_email.
  let timeOnlyMatch = false;
  if (!email && status === "cancelled" && apptDateIso) {
    const { rows, error: lookupErr } = await findByExactTimeOnly(cloud, apptDateIso);
    if (rows.length === 1) {
      timeOnlyMatch = true;
      email = String(rows[0].contact_email || "").trim().toLowerCase();
    }
    if (!timeOnlyMatch) {
      const reason = lookupErr
        ? `cancelled with no email; exact-time lookup failed: ${lookupErr}`
        : `cancelled with no email/name; ${rows.length} BookedIN appointment(s) matched exact time ${apptDateIso}; manual review required`;
      console.warn("cancellation needs manual review:", reason);
      const { data: reviewRow } = await cloud
        .from("bookedin_appointments")
        .insert({
          contact_email: "unknown@bookedin.local",
          contact_name: name || null,
          contact_phone: phone || null,
          appointment_date: apptDateIso,
          appointment_status: status,
          notes,
          raw_payload: payload,
          processed_at: new Date().toISOString(),
          process_error: reason,
        })
        .select("id")
        .single();
      return new Response(
        JSON.stringify({
          success: true,
          skipped: reason,
          log_id: reviewRow?.id ?? null,
          status,
          cancellation: {
            matched: false,
            match_type: null,
            candidates: rows.length,
            matched_appointment_at: apptDateIso,
            cancelled: false,
            manual_review: true,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  if (!email) {
    return new Response(JSON.stringify({ error: "contact_email is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const existing = await findDuplicateLog(cloud, email, status, apptDateIso);

  const alreadyProcessed =
    !!existing?.processed_at && isProcessedOk(existing.process_error);

  if (alreadyProcessed) {
    return new Response(
      JSON.stringify({
        success: true,
        duplicate: true,
        log_id: existing!.id,
        skipped: existing!.process_error,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let logId: string;
  let duplicate = false;

  if (existing) {
    duplicate = true;
    logId = existing.id;
  } else {
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
      .select("id")
      .single();

    if (logErr) {
      console.error("log insert failed", logErr);
      return new Response(JSON.stringify({ error: `log insert: ${logErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    logId = logRow.id;
  }

  let processError: string | null = null;
  let proxyStatus: number | null = null;
  let proxyBody: unknown = null;
  let skippedReason: string | null = null;

  // Cancellations: contact_name is NOT required. Match the existing contact /
  // appointment by normalized email (+ exact or closest appointment time) and
  // cancel THAT appointment. Only skip when there is no prior BookedIN
  // appointment for this email AND no name — forwarding then would create a
  // blank duplicate contact in the CRM.
  let matchType: string | null = null;
  let matchedName: string | null = name || null;
  let matchedPhone: string | null = phone || null;
  let matchedAppointmentIso: string | null = apptDateIso;
  let matchedLogId: string | null = null;

  if (status === "cancelled") {
    const prior = await findPriorAppointment(cloud, email, apptDateIso);
    if (prior) {
      matchType = timeOnlyMatch ? "exact_time_only" : prior.matchType;
      matchedLogId = prior.row.id as string;
      matchedName = name || (prior.row.contact_name as string | null) || null;
      matchedPhone = phone || (prior.row.contact_phone as string | null) || null;
      matchedAppointmentIso = apptDateIso ?? (prior.row.appointment_date as string | null) ?? null;
    }
  }

  const skipForward =
    status === "cancelled" && !matchedName && !matchType;

  if (skipForward) {
    skippedReason =
      "cancelled event with no matching CRM appointment and no contact name; not forwarded";
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
    const isCancel = status === "cancelled";
    const body = {
      email,
      contact_name: isCancel ? matchedName : name || null,
      first_name: firstName || null,
      last_name: lastName || null,
      contact_phone: isCancel ? matchedPhone : phone || null,
      lifecycle_stage: lifecycleStage,
      appointment_at: isCancel ? matchedAppointmentIso : apptDateIso,
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
      const msg = e instanceof Error ? e.message : String(e);
      if (isBenignCancelledError(status, msg)) {
        // Cancelled contact — the attendee update step failed on the proxy
        // (e.g. "column attendees.email does not exist"). The cancellation
        // itself is already recorded; no further action needed for an
        // attendee that's no longer attending. Mark as benign skip.
        skippedReason = `skipped (cancelled, attendee update): ${msg}`;
        console.warn("benign cancelled attendee error:", msg);
      } else {
        processError = msg;
        console.error("proxy call failed", processError);
      }
    }
  }

  // appointment_at is now persisted by the leadjig-update-from-bookedin proxy.

  await cloud
    .from("bookedin_appointments")
    .update({
      processed_at: new Date().toISOString(),
      process_error: processError ?? skippedReason,
    })
    .eq("id", logId);

  // Fire admin email alert on real failures (not benign skips).
  if (processError) {
    try {
      const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY");
      const SENDGRID_FROM_EMAIL = Deno.env.get("SENDGRID_FROM_EMAIL");
      const ADMIN_ALERT_EMAIL = "michaeleberhardt01@gmail.com";
      if (SENDGRID_API_KEY && SENDGRID_FROM_EMAIL) {
        const apptHuman = apptDateIso
          ? new Date(apptDateIso).toLocaleString("en-US", {
              timeZone: "America/Phoenix",
              dateStyle: "full",
              timeStyle: "short",
            }) + " (Arizona)"
          : "(no appointment date in payload)";
        const stepFailed = processError.startsWith("proxy ")
          ? "LeadJig proxy update (leadjig-update-from-bookedin)"
          : processError.startsWith("log insert")
          ? "writing audit row to bookedin_appointments"
          : "BookedIN → CRM sync";

        const lines = [
          "A BookedIN appointment failed to sync to the CRM.",
          "",
          `Contact:        ${name || "(no name)"}`,
          `Email:          ${email}`,
          `Phone:          ${phone || "(none)"}`,
          `Appointment:    ${apptHuman}`,
          `Status:         ${status}`,
          `Failed step:    ${stepFailed}`,
          `Error:          ${processError}`,
          "",
          `Log id:         ${logId}`,
          `Received:       ${new Date().toISOString()}`,
          "",
          "Open the Failed Syncs page in the CRM to review and resolve.",
        ];

        await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SENDGRID_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: ADMIN_ALERT_EMAIL }] }],
            from: { email: SENDGRID_FROM_EMAIL, name: "Leadjig CRM Alerts" },
            subject: "CRM Sync Failed",
            content: [{ type: "text/plain", value: lines.join("\n") }],
          }),
        });
      } else {
        console.warn("admin alert skipped: SendGrid env not configured");
      }
    } catch (alertErr) {
      console.error("admin alert email failed", alertErr);
    }
  }


  if (status === "cancelled") {
    console.log("cancellation handled", JSON.stringify({
      email, match_type: matchType, matched_log_id: matchedLogId,
      matched_appointment_at: matchedAppointmentIso, skipped: skippedReason,
      error: processError,
    }));
  }

  return new Response(
    JSON.stringify({
      success: !processError,
      duplicate,
      skipped: skippedReason,
      log_id: logId,
      status,
      cancellation: status === "cancelled"
        ? {
            matched: !!matchType,
            match_type: matchType,
            matched_log_id: matchedLogId,
            matched_contact_name: matchedName,
            matched_contact_email: email,
            matched_appointment_at: matchedAppointmentIso,
            cancelled: !processError && !skipForward,
          }
        : undefined,
      proxy_status: proxyStatus,
      proxy_response: proxyBody,
      error: processError,
    }),

    { status: processError ? 502 : 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
