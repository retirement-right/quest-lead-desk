// Scheduler: runs every minute (via pg_cron). Calls the Retirement-Right
// proxy edge function to fetch due auto-send follow-ups (which has service-role
// access bypassing RLS), then dispatches Email/SMS using the admin-authored
// message body, and asks the proxy to mark them sent + update status.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jsonResponse, normalizePhone, requireCronSecret } from "../_shared/followup-auth.ts";

const PROXY_URL =
  "https://uoneplysuvmaygbrbswd.supabase.co/functions/v1/leadjig-followups-proxy";
const SHARED_SECRET = Deno.env.get("LEADJIG_SHARED_SECRET")!;

// Lovable Cloud project (for activity log)
const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY")!;
const SENDGRID_FROM_EMAIL = Deno.env.get("SENDGRID_FROM_EMAIL")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER")!;

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

async function proxy(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shared-secret": SHARED_SECRET,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`proxy ${action} ${res.status}: ${text}`);
  return body;
}

interface DueLead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  do_not_email: boolean | null;
  raw_payload: Record<string, any> | null;
  client_profile: Record<string, any> | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const cronDenied = await requireCronSecret(req);
  if (cronDenied) return cronDenied;


  const summary = { scanned: 0, sent: 0, skipped: 0, errors: [] as string[] };

  try {
    const cloud = createClient(CLOUD_URL, CLOUD_SERVICE_ROLE);

    const listResp = await proxy("list_due");
    const leads: DueLead[] = listResp.leads ?? [];
    console.log(`process-followups: proxy returned ${leads.length} due lead(s)`);

    for (const lead of leads) {
      summary.scanned += 1;
      const cp = (lead.client_profile ?? {}) as Record<string, any>;
      const type = String(cp.followup_type || "").toLowerCase();
      const rp = (lead.raw_payload ?? {}) as Record<string, any>;
      const firstName = String(
        rp.first_name || (lead.name ? String(lead.name).split(" ")[0] : "") || "",
      ).trim();
      const customMessage = String(cp.followup_message || "").trim();

      if (type !== "email" && type !== "sms") {
        summary.skipped += 1;
        continue;
      }

      let recipient = "";
      let body = "";
      try {
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

        await proxy("mark_sent", { lead_id: lead.id, sent_at: sentAt });

        await cloud.from("contact_activity").insert({
          lead_id: lead.id,
          type: "followup_auto_send",
          channel: type,
          recipient,
          body,
          status: "sent",
        });

        // Admin notification: every successful auto-send SMS, never for emails.
        if (type === "sms") {
          await notifyFollowupSmsSent(String(lead.name ?? ""), recipient);
        }

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
        if (type === "sms") {
          await notifyFollowupSmsFailed(String(lead.name ?? ""), recipient);
        } else {
          await notifyFollowupEmailFailed(String(lead.name ?? ""), recipient);
        }
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
