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

const FROM_EMAIL = "michael@retirement-right.com";
const FROM_NAME = "Michael Eberhardt | Retirement Right";
const REPLY_TO = "michael@retirement-right.com";
const BCC_EMAIL = "michaeleberhardt01@gmail.com";

const greetingName = (firstName: string) => {
  const f = (firstName ?? "").trim();
  return f.length > 0 ? f : "Valued Friend";
};

const BODY = (firstName: string) => {
  const greet = greetingName(firstName);
  return `Dear ${greet},

Today is your day, and we didn't want it to pass without reaching out to say — Happy Birthday! 🎉

Here at Retirement Right, we consider it a privilege to be part of your journey toward a secure and fulfilling retirement. On a day like today, we hope you're surrounded by the people and moments that matter most to you.

As you celebrate another year, we also want to remind you that your retirement future deserves the same attention. Whether you're fine-tuning your Social Security strategy, reviewing your income plan, or just want a second set of eyes on where things stand — we're always just a call away.

🎁 As our birthday gift to you: If you'd like a complimentary retirement check-in this month, just reply to this email or call us directly — no agenda, just a friendly conversation.

Enjoy every moment of your special day!

With warm regards,
The Eberhardt Family | Retirement Right | www.retirement-right.com | Serving Arizona Families`;
};

const SUBJECT = (firstName: string) =>
  `🎂 Happy Birthday, ${greetingName(firstName)}! A Special Note from the Eberhardt Family`;

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

    const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY");
    if (!SENDGRID_API_KEY) throw new Error("SendGrid not configured");

    body = (await req.json()) as Body;
    to = normalizeEmail(String(body.email ?? ""));
    if (!to) {
      await admin.from("birthday_outreach_log").insert({
        contact_id: body.contactId,
        contact_name: body.contactName,
        recipient: String(body.email ?? ""),
        outreach_type: "email-failed",
        sent_by: sentBy,
        year_sent: new Date().getFullYear(),
        person_kind: body.personKind,
        notes: "Invalid email address",
      });
      return jsonResponse({ success: false, error: "Invalid email" }, 400);
    }

    // SendGrid rejects (400) any personalization where an address repeats across to/cc/bcc.
    const bcc = normalizeEmail(BCC_EMAIL);
    const personalization: Record<string, unknown> = { to: [{ email: to }] };
    if (bcc && bcc !== to) personalization.bcc = [{ email: bcc }];

    const sgRes = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [personalization],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        reply_to: { email: REPLY_TO },
        subject: SUBJECT(body.firstName),
        content: [{ type: "text/plain", value: BODY(body.firstName) }],
      }),
    });
    if (!sgRes.ok) {
      const t = await sgRes.text();
      throw new Error(`SendGrid [${sgRes.status}]: ${t}`);
    }

    await admin.from("birthday_outreach_log").insert({
      contact_id: body.contactId,
      contact_name: body.contactName,
      recipient: to,
      outreach_type: "email",
      sent_by: sentBy,
      year_sent: new Date().getFullYear(),
      person_kind: body.personKind,
      notes: personalization.bcc ? `BCC: ${bcc}` : "No BCC (recipient is admin address)",
    });

    return jsonResponse({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("send-birthday-email:", msg);
    if (body) {
      try {
        await admin.from("birthday_outreach_log").insert({
          contact_id: body.contactId,
          contact_name: body.contactName,
          recipient: to || String(body.email ?? ""),
          outreach_type: "email-failed",
          sent_by: sentBy,
          year_sent: new Date().getFullYear(),
          person_kind: body.personKind,
          notes: msg.slice(0, 2000),
        });
      } catch (logErr) {
        console.error("send-birthday-email log failure:", logErr);
      }
    }
    return jsonResponse({ success: false, error: msg }, 200);
  }
});
