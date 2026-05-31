import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { jsonResponse, requireStaffAuth, normalizeEmail } from "../_shared/followup-auth.ts";

interface Body {
  contactId: string;
  personKind: "primary" | "spouse";
  firstName: string;
  contactName: string;
  email: string;
}

const BODY = (firstName: string) => `Dear ${firstName},

Today is your day, and we didn't want it to pass without reaching out to say — Happy Birthday! 🎉

Here at Retirement Right, we consider it a privilege to be part of your journey toward a secure and fulfilling retirement. On a day like today, we hope you're surrounded by the people and moments that matter most to you.

As you celebrate another year, we also want to remind you that your retirement future deserves the same attention. Whether you're fine-tuning your Social Security strategy, reviewing your income plan, or just want a second set of eyes on where things stand — we're always just a call away.

🎁 As our birthday gift to you: If you'd like a complimentary retirement check-in this month, just reply to this email or call us directly — no agenda, just a friendly conversation.

Enjoy every moment of your special day!

With warm regards,
The Eberhardt Family | Retirement Right | www.retirement-right.com | Serving Arizona Families`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY");
    const SENDGRID_FROM_EMAIL = Deno.env.get("SENDGRID_FROM_EMAIL");
    if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL) throw new Error("SendGrid not configured");

    const body = (await req.json()) as Body;
    const to = normalizeEmail(String(body.email ?? ""));
    if (!to) return jsonResponse({ error: "Invalid email" }, 400);
    const firstName = (body.firstName || "Friend").trim();

    const sgRes = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: SENDGRID_FROM_EMAIL, name: "The Eberhardt Family" },
        subject: `🎂 Happy Birthday, ${firstName}! A Special Note from the Eberhardt Family`,
        content: [{ type: "text/plain", value: BODY(firstName) }],
      }),
    });
    if (!sgRes.ok) {
      const t = await sgRes.text();
      throw new Error(`SendGrid [${sgRes.status}]: ${t}`);
    }

    // Get sender email for log
    const jwt = req.headers.get("Authorization")!.slice(7).trim();
    const cli = createClient("https://uoneplysuvmaygbrbswd.supabase.co", Deno.env.get("LEADJIG_ANON_KEY") ?? "sb_publishable_8Vv7urmF3VqUXH3avaxrsg_cfSNKWr1");
    const { data: u } = await cli.auth.getUser(jwt);
    const sentBy = u?.user?.email ?? null;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("birthday_outreach_log").insert({
      contact_id: body.contactId,
      contact_name: body.contactName,
      recipient: to,
      outreach_type: "email",
      sent_by: sentBy,
      year_sent: new Date().getFullYear(),
      person_kind: body.personKind,
    });

    return jsonResponse({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("send-birthday-email:", msg);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});
