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
    const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY");
    const SENDGRID_FROM_EMAIL = Deno.env.get("SENDGRID_FROM_EMAIL");
    if (!SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY not configured");
    if (!SENDGRID_FROM_EMAIL) throw new Error("SENDGRID_FROM_EMAIL not configured");

    const body = (await req.json()) as Body;
    const to = (body.to ?? "").trim();
    const firstName = (body.firstName ?? "").trim() || "there";

    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return new Response(JSON.stringify({ error: "Invalid recipient email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = `Hi ${firstName}, this is Michael Eberhardt from Retirement Right. I wanted to follow up with you regarding your retirement planning. Please feel free to call me at 480-726-8805 or reply to this email. Thank you!`;

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

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("send-followup-email error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
