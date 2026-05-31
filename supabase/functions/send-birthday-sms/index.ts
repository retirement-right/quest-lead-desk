import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { jsonResponse, requireStaffAuth, normalizePhone } from "../_shared/followup-auth.ts";

interface Body {
  contactId: string;
  personKind: "primary" | "spouse";
  firstName: string;
  contactName: string;
  phone: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TOK = Deno.env.get("TWILIO_AUTH_TOKEN");
    const FROM = Deno.env.get("TWILIO_PHONE_NUMBER");
    if (!SID || !TOK || !FROM) throw new Error("Twilio not configured");

    const body = (await req.json()) as Body;
    const to = normalizePhone(String(body.phone ?? ""));
    if (!to) return jsonResponse({ error: "Invalid phone" }, 400);
    const firstName = (body.firstName || "Friend").trim();

    const text = `Happy Birthday ${firstName}! 🎂 Wishing you a wonderful day from all of us at Retirement Right. If you'd like a complimentary retirement check-in this month, just reply or call us! — The Eberhardt Family | www.retirement-right.com`;

    const twAuth = btoa(`${SID}:${TOK}`);
    const twRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${twAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: FROM, Body: text }),
    });
    const data = await twRes.json();
    if (!twRes.ok) throw new Error(`Twilio [${twRes.status}]: ${JSON.stringify(data)}`);

    const jwt = req.headers.get("Authorization")!.slice(7).trim();
    const cli = createClient("https://uoneplysuvmaygbrbswd.supabase.co", Deno.env.get("LEADJIG_ANON_KEY") ?? "sb_publishable_8Vv7urmF3VqUXH3avaxrsg_cfSNKWr1");
    const { data: u } = await cli.auth.getUser(jwt);
    const sentBy = u?.user?.email ?? null;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
    return jsonResponse({ success: false, error: msg }, 500);
  }
});
