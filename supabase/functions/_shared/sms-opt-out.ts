// Manual SMS opt-out guard, derived only from inbound texts the CRM already
// stores (contact_activity inbound + inbound_sms_unmatched). The latest
// carrier keyword wins: STOP-type blocks, START-type re-allows.
// Indexed server-side keyword filtering has no message-history cap.
// Any lookup error or malformed result blocks the send (fail closed).

const OPT_OUT = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "STOP ALL", "OPT OUT"]);
const OPT_IN = new Set(["START", "UNSTOP", "YES"]);

export type OptOutResult = { blocked: false } | { blocked: true; reason: "opted_out" | "unavailable" };
type Client = { rpc: (name: string, args: { _phone: string }) => PromiseLike<{ data: unknown; error: unknown }> };

export function normalizeSmsPhone(raw: string): string | null {
  const text = raw.trim();
  if (!/^\+?[\d () .-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) return /^[1-9]\d{9,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function keywordOf(body: unknown): "out" | "in" | null {
  const k = String(body ?? "").trim().toUpperCase().replace(/[.!\s]+$/g, "").replace(/\s+/g, " ");
  if (OPT_OUT.has(k)) return "out";
  if (OPT_IN.has(k)) return "in";
  return null;
}

export function decideOptOut(rows: { body: unknown; at: unknown }[]): OptOutResult {
  const keyed = rows
    .map((r) => ({ k: keywordOf(r.body), t: Date.parse(String(r.at)) }))
    .filter((r) => r.k !== null);
  if (keyed.some((r) => Number.isNaN(r.t))) return { blocked: true, reason: "unavailable" };
  keyed.sort((a, b) => b.t - a.t || Number(b.k === "out") - Number(a.k === "out"));
  return keyed[0]?.k === "out" ? { blocked: true, reason: "opted_out" } : { blocked: false };
}

export async function checkSmsOptOut(client: Client | null, phoneE164: string): Promise<OptOutResult> {
  const phone = normalizeSmsPhone(phoneE164);
  if (!client || !phone) return { blocked: true, reason: "unavailable" };
  try {
    const result = await client.rpc("sms_opt_out_status", { _phone: phone });
    if (result?.error || !["allowed", "opted_out"].includes(String(result?.data)) || typeof result?.data !== "string") return { blocked: true, reason: "unavailable" };
    return result.data === "opted_out" ? { blocked: true, reason: "opted_out" } : { blocked: false };
  } catch {
    return { blocked: true, reason: "unavailable" };
  }
}

export const OPT_OUT_MESSAGE = "This contact has texted STOP, so text messages are blocked.";
export const OPT_OUT_UNAVAILABLE_MESSAGE = "Text opt-out status could not be checked, so the text was not sent.";
