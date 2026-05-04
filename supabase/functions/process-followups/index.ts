// Scheduler: runs every minute (via pg_cron). Finds leads with an auto-send
// follow-up that's due and not yet sent, then dispatches Email/SMS using the
// admin-authored SMS/Email Message body, marks sent, and logs to contact_activity.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

// External Supabase (where leadjig_leads lives) — anon key, RLS-friendly
const LEADJIG_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
const LEADJIG_ANON = "sb_publishable_8Vv7urmF3VqUXH3avaxrsg_cfSNKWr1";

// Lovable Cloud project (for activity log)
const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY")!;
const SENDGRID_FROM_EMAIL = Deno.env.get("SENDGRID_FROM_EMAIL")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER")!;

function normalizePhone(raw: string): string | null {
  const onlyNums = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) {
    const e = "+" + onlyNums;
    return /^\+\d{10,15}$/.test(e) ? e : null;
  }
  if (onlyNums.length === 10) return `+1${onlyNums}`;
  if (onlyNums.length === 11 && onlyNums.startsWith("1")) return `+${onlyNums}`;
  return null;
}

function defaultEmailBody(firstName: string) {
  return `Hi ${firstName || "there"}, this is Michael Eberhardt from Retirement Right. I wanted to follow up with you regarding your retirement planning. Please feel free to call me at 480-726-8805 or reply to this email. Thank you!`;
}
function defaultSmsBody(firstName: string) {
  return `Hi ${firstName || "there"}, this is Michael from Retirement Right. Just checking in — give me a call at 480-726-8805 when you have a moment. Thank you!`;
}

async function sendEmail(to: string, body: string) {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDGRID_FROM_EMAIL, name: "Michael Eberhardt" },
      subject: "Following up on your retirement planning",
      content: [{ type: "text/plain", value: body }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`SendGrid ${res.status}: ${t}`);
  }
}

async function sendSms(to: string, body: string) {
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Body: body }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${JSON.stringify(data)}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const summary = { scanned: 0, sent: 0, skipped: 0, errors: [] as string[] };

  try {
    const sb = createClient(LEADJIG_URL, LEADJIG_ANON);
    const cloud = createClient(CLOUD_URL, CLOUD_SERVICE_ROLE);
    const nowIso = new Date().toISOString();

    const { data, error } = await sb
      .from("leadjig_leads")
      .select("id, name, email, phone, raw_payload, client_profile, do_not_email")
      .limit(1000);

    if (error) throw new Error(`query leads: ${error.message}`);

    for (const lead of data ?? []) {
      const cp = (lead.client_profile ?? {}) as Record<string, any>;
      if (!cp.followup_auto_send) continue;
      if (!cp.followup_date) continue;
      if (cp.followup_sent_at) continue;
      if ((cp.followup_status ?? "Pending") !== "Pending") continue;
      if (new Date(cp.followup_date).toISOString() > nowIso) continue;

      summary.scanned += 1;
      const type = String(cp.followup_type || "").toLowerCase();
      const rp = (lead.raw_payload ?? {}) as Record<string, any>;
      const firstName = String(
        rp.first_name || (lead.name ? String(lead.name).split(" ")[0] : "") || "",
      ).trim();
      const customMessage = String(cp.followup_message || "").trim();

      // Call / In-Person never auto-send
      if (type !== "email" && type !== "sms") {
        summary.skipped += 1;
        continue;
      }

      try {
        let recipient = "";
        let body = "";
        if (type === "email") {
          if (lead.do_not_email) { summary.skipped += 1; continue; }
          const to = String(lead.email || "").trim();
          if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { summary.skipped += 1; continue; }
          recipient = to;
          body = customMessage || defaultEmailBody(firstName);
          await sendEmail(to, body);
        } else {
          const to = normalizePhone(String(lead.phone || ""));
          if (!to) { summary.skipped += 1; continue; }
          recipient = to;
          body = customMessage || defaultSmsBody(firstName);
          await sendSms(to, body);
        }

        const sentAt = new Date().toISOString();

        // Mark as sent + Completed
        const updatedCp = {
          ...cp,
          followup_sent_at: sentAt,
          followup_status: "Completed",
        };
        const { error: upErr } = await sb
          .from("leadjig_leads")
          .update({ client_profile: updatedCp })
          .eq("id", lead.id);
        if (upErr) throw upErr;

        // Log to activity
        await cloud.from("contact_activity").insert({
          lead_id: lead.id,
          type: "followup_auto_send",
          channel: type,
          recipient,
          body,
          status: "sent",
        });

        summary.sent += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("followup send failed", lead.id, msg);
        summary.errors.push(`${lead.id}: ${msg}`);
        await cloud.from("contact_activity").insert({
          lead_id: lead.id,
          type: "followup_auto_send",
          channel: type,
          status: "error",
          error: msg,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    console.error("process-followups fatal:", msg);
    return new Response(JSON.stringify({ success: false, error: msg, ...summary }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
