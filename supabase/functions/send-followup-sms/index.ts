import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import {
  jsonResponse,
  loadLeadRecipient,
  requireStaffAuth,
} from "../_shared/followup-auth.ts";
import {
  notifyFollowupSmsFailed,
  notifyFollowupSmsSent,
} from "../_shared/admin-notify.ts";

interface Body {
  leadId?: string;
  /** true when dispatched by the scheduled auto-send flow (admin gets a ping). */
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

  // Populated as soon as we know them, so the failure path can name the client.
  let isAuto = false;
  let clientName = "";
  let clientPhone = "";

  try {
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
    if (!TWILIO_ACCOUNT_SID) throw new Error("TWILIO_ACCOUNT_SID not configured");
    if (!TWILIO_AUTH_TOKEN) throw new Error("TWILIO_AUTH_TOKEN not configured");
    if (!TWILIO_PHONE_NUMBER) throw new Error("TWILIO_PHONE_NUMBER not configured");

    const body = (await req.json()) as Body;
    const leadId = String(body.leadId ?? "").trim();
    isAuto = body.auto === true;
    clientName = String(body.clientName ?? "").trim();
    if (!leadId) {
      return jsonResponse({ error: "leadId is required" }, 400);
    }

    const lead = await loadLeadRecipient(leadId, "sms", auth.jwt);
    if (lead instanceof Response) {
      if (isAuto) await notifyFollowupSmsFailed(clientName, clientPhone);
      return lead;
    }
    const { recipient: to, firstName, fullName } = lead;
    clientPhone = to;
    clientName = clientName || fullName;

    const text = `Hi ${firstName}, this is Michael from Retirement Right. Just checking in — give me a call at 480-726-8805 when you have a moment. Thank you!`;

    const twAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const twRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${twAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: to,
          From: TWILIO_PHONE_NUMBER,
          Body: text,
        }),
      },
    );

    const data = await twRes.json();
    if (!twRes.ok) {
      throw new Error(`Twilio error [${twRes.status}]: ${JSON.stringify(data)}`);
    }

    // Client message accepted by Twilio — now (and only now) ping the admin.
    if (isAuto) await notifyFollowupSmsSent(clientName, clientPhone);

    return jsonResponse({ success: true, sid: data.sid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("send-followup-sms error:", msg);
    if (isAuto) await notifyFollowupSmsFailed(clientName, clientPhone);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});
