import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { readManualDispatchBody } from "../_shared/automatic-dispatch.ts";
import {
  jsonResponse,
  loadLeadRecipient,
  requireStaffAuth,
} from "../_shared/followup-auth.ts";
import { notifyFollowupEmailFailed } from "../_shared/admin-notify.ts";
import { marketingEmailAllowed, MARKETING_BLOCKED } from "../_shared/marketing-policy.ts";
import { WEBSITE_PUBLISHABLE_KEY } from "../_shared/website-rest.ts";
import { cloudEmailRecipientAllowed } from "../_shared/cloud-email-suppression.ts";

interface Body {
  leadId?: string;
  /** true when dispatched by the scheduled auto-send flow. */
  auto?: boolean;
  clientName?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  const dispatchBody = await readManualDispatchBody(req);
  if (dispatchBody instanceof Response) return dispatchBody;

  if (!(await marketingEmailAllowed({ apiKey: WEBSITE_PUBLISHABLE_KEY, token: auth.jwt }))) {
    return jsonResponse(MARKETING_BLOCKED);
  }

  let isAuto = false;
  let clientName = "";
  let clientEmail = "";

  try {
    const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY");
    const SENDGRID_FROM_EMAIL = Deno.env.get("SENDGRID_FROM_EMAIL");
    if (!SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY not configured");
    if (!SENDGRID_FROM_EMAIL) throw new Error("SENDGRID_FROM_EMAIL not configured");

    const body = dispatchBody as Body;
    const leadId = String(body.leadId ?? "").trim();
    isAuto = body.auto === true;
    clientName = String(body.clientName ?? "").trim();
    if (!leadId) {
      return jsonResponse({ error: "leadId is required" }, 400);
    }

    const lead = await loadLeadRecipient(leadId, "email", auth.jwt);
    if (lead instanceof Response) {
      if (isAuto) await notifyFollowupEmailFailed(clientName, clientEmail);
      return lead;
    }
    const { recipient: to, firstName, fullName } = lead;
    clientEmail = to;
    clientName = clientName || fullName;

    const text = `Hi ${firstName}, this is Michael Eberhardt from Retirement Right. I wanted to follow up with you regarding your retirement planning. Please feel free to call me at 480-726-8805 or reply to this email. Thank you!`;

    // Recheck after recipient lookup, immediately before the provider boundary.
    if (!(await cloudEmailRecipientAllowed(to)) ||
      !(await marketingEmailAllowed({ apiKey: WEBSITE_PUBLISHABLE_KEY, token: auth.jwt }))) {
      return jsonResponse(MARKETING_BLOCKED);
    }
    const sgRes = await fetch("https://api.sendgrid.com/v3/mail/send", {
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

    if (!sgRes.ok) {
      const errText = await sgRes.text();
      throw new Error(`SendGrid error [${sgRes.status}]: ${errText}`);
    }

    // Successful emails are intentionally silent — alerts only on failure.
    return jsonResponse({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("send-followup-email error:", msg);
    if (isAuto) await notifyFollowupEmailFailed(clientName, clientEmail);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});
