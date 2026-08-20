// Twilio inbound SMS webhook.
// Public endpoint (verify_jwt = false) — authenticity is enforced with Twilio's
// X-Twilio-Signature HMAC-SHA1 request validation, not a JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const LEADJIG_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
const LEADJIG_ANON_KEY =
  Deno.env.get("LEADJIG_ANON_KEY") ?? "sb_publishable_8Vv7urmF3VqUXH3avaxrsg_cfSNKWr1";

const TWIML_OK = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(status = 200) {
  return new Response(TWIML_OK, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function textResponse(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

/** Digits-only tail (last 10) used for tolerant phone matching. */
function phoneTail(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function normalizeE164(raw: string): string {
  const s = (raw || "").trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Candidate URLs Twilio may have signed (proxy/host/path/scheme variations). */
function candidateUrls(req: Request): string[] {
  const urls: string[] = [];
  const push = (v: string) => {
    if (v && !urls.includes(v)) urls.push(v);
  };
  const override = Deno.env.get("TWILIO_WEBHOOK_URL");
  if (override) push(override);

  const u = new URL(req.url);
  const fwdHost = req.headers.get("x-forwarded-host");
  const host = req.headers.get("host");
  const fwdProto = req.headers.get("x-forwarded-proto");
  const hosts = [fwdHost, host, u.host].filter(Boolean) as string[];
  const protos = Array.from(new Set([fwdProto || "https", "https", "http"]));

  // Twilio may have been configured with or without the query string and with
  // or without a trailing slash; the signature is computed on that exact string.
  const paths = [
    `${u.pathname}${u.search}`,
    u.pathname,
    u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : `${u.pathname}/`,
  ];

  for (const proto of protos) {
    for (const h of hosts) {
      for (const p of paths) push(`${proto}://${h}${p}`);
    }
  }
  return urls;
}

async function validateTwilioSignature(
  req: Request,
  params: Record<string, string>,
  signature: string,
  authToken: string,
): Promise<boolean> {
  const sortedConcat = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  const tried: string[] = [];
  for (const url of candidateUrls(req)) {
    tried.push(url);
    const expected = await hmacSha1Base64(authToken, `${url}${sortedConcat}`);
    if (timingSafeEqual(expected, signature)) return true;
  }
  console.warn(
    `twilio-inbound-sms: signature mismatch. candidates tried=${JSON.stringify(tried)}`,
  );
  return false;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return textResponse("Method not allowed", 405);
  }

  // Primary token, plus an optional secondary token when the inbound number
  // lives on a different Twilio account/subaccount than outbound sending.
  const authTokens = [
    Deno.env.get("TWILIO_AUTH_TOKEN"),
    Deno.env.get("TWILIO_AUTH_TOKEN_INBOUND"),
  ].filter((t): t is string => !!t);
  if (authTokens.length === 0) {
    console.error("twilio-inbound-sms: TWILIO_AUTH_TOKEN not configured");
    return textResponse("Server not configured", 500);
  }

  // Parse the form-encoded Twilio payload.
  let params: Record<string, string> = {};
  try {
    const raw = await req.text();
    params = Object.fromEntries(new URLSearchParams(raw).entries());
  } catch (_e) {
    return textResponse("Bad request", 400);
  }

  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!signature) {
    console.warn("twilio-inbound-sms: rejected request without X-Twilio-Signature");
    return textResponse("Forbidden", 403);
  }
  let valid = false;
  for (const token of authTokens) {
    if (await validateTwilioSignature(req, params, signature, token)) {
      valid = true;
      break;
    }
  }
  if (!valid) {
    const configuredSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
    const requestSid = params.AccountSid ?? "";
    console.warn(
      "twilio-inbound-sms: rejected request with invalid signature. " +
        `to=${params.To ?? ""} account_sid_matches_configured=${
          !!requestSid && requestSid === configuredSid
        } request_account_sid_tail=${requestSid.slice(-4)} tokens_tried=${authTokens.length}`,
    );
    return textResponse("Forbidden", 403);
  }

  const messageSid = params.MessageSid || params.SmsSid || "";
  const from = normalizeE164(params.From || "");
  const to = normalizeE164(params.To || "");
  const body = params.Body ?? "";
  const numMedia = Number.parseInt(params.NumMedia || "0", 10) || 0;
  const providerStatus = params.SmsStatus || params.MessageStatus || "received";

  if (!messageSid || !from) {
    console.warn("twilio-inbound-sms: missing MessageSid or From");
    // Ack anyway so Twilio does not retry a malformed payload forever.
    return twiml();
  }

  const cloudUrl = Deno.env.get("SUPABASE_URL")!;
  const cloudServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cloud = createClient(cloudUrl, cloudServiceKey);

  try {
    // Idempotency: already stored?
    const [{ data: existingActivity }, { data: existingUnmatched }] = await Promise.all([
      cloud.from("contact_activity").select("id").eq("message_sid", messageSid).maybeSingle(),
      cloud.from("inbound_sms_unmatched").select("id").eq("message_sid", messageSid).maybeSingle(),
    ]);
    if (existingActivity || existingUnmatched) {
      console.log(`twilio-inbound-sms: duplicate ${messageSid} ignored`);
      return twiml();
    }

    const metadata: Record<string, unknown> = {
      from_raw: params.From ?? null,
      to_raw: params.To ?? null,
      num_media: numMedia,
      media: Array.from({ length: numMedia }, (_, i) => ({
        url: params[`MediaUrl${i}`] ?? null,
        content_type: params[`MediaContentType${i}`] ?? null,
      })),
      from_city: params.FromCity ?? null,
      from_state: params.FromState ?? null,
      from_zip: params.FromZip ?? null,
      from_country: params.FromCountry ?? null,
      account_sid: params.AccountSid ?? null,
      messaging_service_sid: params.MessagingServiceSid ?? null,
      sms_status: params.SmsStatus ?? null,
      message_status: params.MessageStatus ?? null,
      error_code: params.ErrorCode ?? null,
    };

    // Match the sender to a LeadJig lead by phone (last 10 digits).
    let leadId: string | null = null;
    const tail = phoneTail(params.From || "");
    if (tail) {
      const serviceKey = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY");
      const leadjig = createClient(LEADJIG_URL, serviceKey || LEADJIG_ANON_KEY);
      const { data: leads, error: leadErr } = await leadjig
        .from("leadjig_leads")
        .select("id, phone, created_at")
        .ilike("phone", `%${tail.slice(-7)}%`)
        .limit(50);
      if (leadErr) {
        console.error("twilio-inbound-sms: lead lookup failed:", leadErr.message);
      } else {
        const matches = (leads ?? []).filter((l: any) => phoneTail(String(l.phone ?? "")) === tail);
        if (matches.length > 0) {
          matches.sort(
            (a: any, b: any) =>
              new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
          );
          leadId = matches[0].id as string;
        }
      }
    }

    if (leadId) {
      const { error } = await cloud.from("contact_activity").insert({
        lead_id: leadId,
        type: "sms_inbound",
        channel: "sms",
        direction: "inbound",
        recipient: to,
        sender: from,
        to_number: to,
        message_sid: messageSid,
        provider_status: providerStatus,
        body: body || (numMedia > 0 ? `(${numMedia} media attachment(s))` : ""),
        status: "received",
        metadata,
      });
      if (error && error.code !== "23505") {
        console.error("twilio-inbound-sms: activity insert failed:", error.message);
      } else {
        console.log(`twilio-inbound-sms: stored ${messageSid} for lead ${leadId}`);
      }
    } else {
      const { error } = await cloud.from("inbound_sms_unmatched").insert({
        message_sid: messageSid,
        from_number: from,
        to_number: to,
        body,
        num_media: numMedia,
        provider_status: providerStatus,
        metadata,
      });
      if (error && error.code !== "23505") {
        console.error("twilio-inbound-sms: unmatched insert failed:", error.message);
      } else {
        console.log(`twilio-inbound-sms: queued unmatched ${messageSid} from ${from}`);
      }
    }
  } catch (e) {
    // Never fail the webhook loudly — log and ack so Twilio does not retry storms.
    console.error("twilio-inbound-sms error:", e instanceof Error ? e.message : e);
  }

  return twiml();
});
