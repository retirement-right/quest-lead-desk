import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface Body {
  to: string;
  firstName?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
    if (!TWILIO_ACCOUNT_SID) throw new Error("TWILIO_ACCOUNT_SID not configured");
    if (!TWILIO_AUTH_TOKEN) throw new Error("TWILIO_AUTH_TOKEN not configured");
    if (!TWILIO_PHONE_NUMBER) throw new Error("TWILIO_PHONE_NUMBER not configured");

    const body = (await req.json()) as Body;
    const toRaw = (body.to ?? "").trim();
    const firstName = (body.firstName ?? "").trim() || "there";

    // Normalize US phone to E.164 if needed
    const digits = toRaw.replace(/[^\d+]/g, "");
    let to = digits;
    if (!to.startsWith("+")) {
      const onlyNums = to.replace(/\D/g, "");
      if (onlyNums.length === 10) to = `+1${onlyNums}`;
      else if (onlyNums.length === 11 && onlyNums.startsWith("1")) to = `+${onlyNums}`;
      else to = `+${onlyNums}`;
    }
    if (!/^\+\d{10,15}$/.test(to)) {
      return new Response(JSON.stringify({ error: "Invalid phone number" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = `Hi ${firstName}, this is Michael from Retirement Right. Just checking in — give me a call at 480-726-8805 when you have a moment. Thank you!`;

    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const twRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
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

    return new Response(JSON.stringify({ success: true, sid: data.sid }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("send-followup-sms error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
