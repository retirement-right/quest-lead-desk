import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { jsonResponse, requireStaffAuth, normalizePhone } from "../_shared/followup-auth.ts";

interface Body {
  contactId: string;
  personKind: "primary" | "spouse";
  firstName: string;
  contactName: string;
  phone: string;
  lifecycleStage?: string | null;
}

const isPersonalStage = (stage?: string | null) => {
  const s = (stage ?? "").toLowerCase().trim();
  return s === "hot lead" || s === "hot_lead" || s === "client";
};

const standardSms = (firstName: string) => {
  const f = (firstName ?? "").trim();
  const opener = f.length > 0 ? `Happy Birthday ${f}!` : `Hi there! Happy Birthday!`;
  return `${opener} 🎂 Wishing you a wonderful day from all of us at Retirement Right. As a birthday gift, we'd love to offer you a complimentary retirement check-in this month — no agenda, just a friendly conversation. Reply or call us anytime! — The Eberhardt Family | www.retirement-right.com`;
};

const personalSms = (firstName: string) => {
  const f = (firstName ?? "").trim();
  const opener = f.length > 0 ? `Hi ${f},` : `Hi there!`;
  return `${opener} it's Michael Eberhardt at Retirement Right 🎉 Just wanted to wish you a very Happy Birthday today! Hope it's a great one. If there's anything we can do for you this month — even just a quick check-in on your retirement plan — we're always here. Enjoy your day!`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: Body | null = null;
  let sentBy: string | null = null;
  let to = "";

  try {
    const jwt = req.headers.get("Authorization")!.slice(7).trim();
    const cli = createClient("https://uoneplysuvmaygbrbswd.supabase.co", Deno.env.get("LEADJIG_ANON_KEY") ?? "sb_publishable_8Vv7urmF3VqUXH3avaxrsg_cfSNKWr1");
    const { data: u } = await cli.auth.getUser(jwt);
    sentBy = u?.user?.email ?? null;

    const SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TOK = Deno.env.get("TWILIO_AUTH_TOKEN");
    const FROM = Deno.env.get("TWILIO_PHONE_NUMBER");
    if (!SID || !TOK || !FROM) throw new Error("Twilio not configured");

    body = (await req.json()) as Body;
    to = normalizePhone(String(body.phone ?? ""));
    if (!to) {
      await admin.from("birthday_outreach_log").insert({
        contact_id: body.contactId,
        contact_name: body.contactName,
        recipient: String(body.phone ?? ""),
        outreach_type: "sms-failed",
        sent_by: sentBy,
        year_sent: new Date().getFullYear(),
        person_kind: body.personKind,
        notes: "Invalid phone number",
      });
      return jsonResponse({ success: false, error: "Invalid phone" }, 400);
    }

    const text = isPersonalStage(body.lifecycleStage) ? personalSms(body.firstName) : standardSms(body.firstName);

    const twAuth = btoa(`${SID}:${TOK}`);
    const twRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${twAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: FROM, Body: text }),
    });
    const data = await twRes.json();
    if (!twRes.ok) throw new Error(`Twilio [${twRes.status}]: ${data?.message || JSON.stringify(data)}`);

    await admin.from("birthday_outreach_log").insert({
      contact_id: body.contactId,
      contact_name: body.contactName,
      recipient: to,
      outreach_type: "sms",
      sent_by: sentBy,
      year_sent: new Date().getFullYear(),
      person_kind: body.personKind,
    });

    return jsonResponse({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("send-birthday-sms:", msg);
    if (body) {
      try {
        await admin.from("birthday_outreach_log").insert({
          contact_id: body.contactId,
          contact_name: body.contactName,
          recipient: to || String(body.phone ?? ""),
          outreach_type: "sms-failed",
          sent_by: sentBy,
          year_sent: new Date().getFullYear(),
          person_kind: body.personKind,
          notes: msg.slice(0, 2000),
        });
      } catch (logErr) {
        console.error("send-birthday-sms log failure:", logErr);
      }
    }
    return jsonResponse({ success: false, error: msg }, 500);
  }
});
