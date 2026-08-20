// Admin SMS notifications for automatic (scheduled) follow-up sends.
//
// These messages go to the admin phone only and are deliberately NOT logged to
// contact_activity — the client's own record should show only the client's
// message. Uses the same Twilio credentials/sending number as follow-up sends.

const ADMIN_PHONE = Deno.env.get("ADMIN_ALERT_PHONE") ?? "+14802214264";

function fmtWhen(d = new Date()): string {
  // Arizona (no DST) — the business timezone.
  return d.toLocaleString("en-US", {
    timeZone: "America/Phoenix",
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function sendAdminSms(text: string): Promise<void> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!sid || !token || !from) {
    console.error("admin-notify: Twilio not configured, skipping admin SMS");
    return;
  }
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: ADMIN_PHONE, From: from, Body: text }),
      },
    );
    if (!res.ok) {
      console.error(`admin-notify: Twilio ${res.status}: ${await res.text()}`);
    }
  } catch (e) {
    console.error("admin-notify failed:", e instanceof Error ? e.message : String(e));
  }
}

/** Sent only after Twilio accepted the client's follow-up SMS. */
export function notifyFollowupSmsSent(name: string, phone: string): Promise<void> {
  return sendAdminSms(
    `CRM CONFIRMATION: Follow-up SMS sent to ${name || "client"} at ${phone} on ${fmtWhen()}.`,
  );
}

/** Sent when an automatic client follow-up SMS could not be delivered. */
export function notifyFollowupSmsFailed(name: string, phone: string): Promise<void> {
  return sendAdminSms(
    `CRM ALERT: Follow-up SMS FAILED for ${name || "client"} at ${phone || "unknown number"}. Check CRM Activity.`,
  );
}

/** Sent only when an automatic client follow-up EMAIL fails (no success pings). */
export function notifyFollowupEmailFailed(name: string, email: string): Promise<void> {
  return sendAdminSms(
    `CRM ALERT: Follow-up EMAIL FAILED for ${name || "client"} at ${email || "unknown address"}. Check CRM Activity.`,
  );
}

/** Admin copy of a birthday SMS that Twilio accepted for the client. */
export function notifyBirthdaySmsSent(name: string, phone: string, message: string): Promise<void> {
  return sendAdminSms(
    `BIRTHDAY SMS SENT: ${name || "Client"} — ${phone}\nMessage: ${message}`,
  );
}

/** Sent instead of the copy when the client's birthday SMS failed. */
export function notifyBirthdaySmsFailed(name: string): Promise<void> {
  return sendAdminSms(
    `BIRTHDAY SMS FAILED: ${name || "Client"} — check CRM Outreach History.`,
  );
}
