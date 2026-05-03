// Scheduler: runs every minute (via pg_cron). Finds leads with an auto-send
// follow-up that's due and not yet sent, then dispatches Email/SMS and marks sent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

// External Supabase (where leadjig_leads lives) — anon key, RLS-friendly
const LEADJIG_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
const LEADJIG_ANON = "sb_publishable_8Vv7urmF3VqUXH3avaxrsg_cfSNKWr1";

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

async function sendEmail(to: string, firstName: string) {
  const text = `Hi ${firstName || "there"}, this is Michael Eberhardt from Retirement Right. I wanted to follow up with you regarding your retirement planning. Please feel free to call me at 480-726-8805 or reply to this email. Thank you!`;
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
      content: [{ type: "text/plain", value: text }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`SendGrid ${res.status}: ${t}`);
  }
}

async function sendSms(to: string, firstName: string) {
  const text = `Hi ${firstName || "there"}, this is Michael from Retirement Right. Just checking in — give me a call at 480-726-8805 when you have a moment. Thank you!`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Body: text }),
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
    const nowIso = new Date().toISOString();

    // Pull a reasonable batch. Filter in JS since fields live in JSONB.
    const { data, error } = await sb
      .from("leadjig_leads")
      .select("id, name, first_name, email, phone, raw_payload, client_profile, do_not_email")
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
        lead.first_name || rp.first_name || (lead.name ? String(lead.name).split(" ")[0] : "") || "",
      ).trim();

      try {
        if (type === "email") {
          if (lead.do_not_email) { summary.skipped += 1; continue; }
          const to = String(lead.email || "").trim();
          if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { summary.skipped += 1; continue; }
          await sendEmail(to, firstName);
        } else if (type === "sms") {
          const to = normalizePhone(String(lead.phone || ""));
          if (!to) { summary.skipped += 1; continue; }
          await sendSms(to, firstName);
        } else {
          // Call / In Person — manual reminders, don't auto-send
          summary.skipped += 1;
          continue;
        }

        // Mark as sent (preserve everything else in client_profile)
        const updatedCp = {
          ...cp,
          followup_sent_at: new Date().toISOString(),
          followup_status: "Completed",
        };
        const { error: upErr } = await sb
          .from("leadjig_leads")
          .update({ client_profile: updatedCp })
          .eq("id", lead.id);
        if (upErr) throw upErr;
        summary.sent += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("followup send failed", lead.id, msg);
        summary.errors.push(`${lead.id}: ${msg}`);
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
