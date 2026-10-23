// Manual SMS opt-out guard, derived only from inbound texts the CRM already
// stores (contact_activity inbound + inbound_sms_unmatched). The latest
// carrier keyword wins: STOP-type blocks, START-type re-allows.
// Any lookup error or malformed reply blocks the send (fail closed).

const OPT_OUT = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "STOP ALL", "OPT OUT"]);
const OPT_IN = new Set(["START", "UNSTOP", "YES"]);

export type OptOutResult = { blocked: false } | { blocked: true; reason: "opted_out" | "unavailable" };
type Query = { data: unknown; error: unknown };
// deno-lint-ignore no-explicit-any
type Client = { from: (table: string) => any };

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
  keyed.sort((a, b) => b.t - a.t);
  return keyed[0]?.k === "out" ? { blocked: true, reason: "opted_out" } : { blocked: false };
}

export async function checkSmsOptOut(client: Client | null, phoneE164: string): Promise<OptOutResult> {
  if (!client || !/^\+\d{10,15}$/.test(phoneE164)) return { blocked: true, reason: "unavailable" };
  try {
    const [a, u]: Query[] = await Promise.all([
      client.from("contact_activity").select("body,created_at").eq("direction", "inbound").eq("sender", phoneE164)
        .order("created_at", { ascending: false }).limit(200),
      client.from("inbound_sms_unmatched").select("body,received_at").eq("from_number", phoneE164)
        .order("received_at", { ascending: false }).limit(200),
    ]);
    if (a?.error || u?.error || !Array.isArray(a?.data) || !Array.isArray(u?.data)) return { blocked: true, reason: "unavailable" };
    const rows = [
      ...(a.data as Record<string, unknown>[]).map((r) => ({ body: r?.body, at: r?.created_at })),
      ...(u.data as Record<string, unknown>[]).map((r) => ({ body: r?.body, at: r?.received_at })),
    ];
    return decideOptOut(rows);
  } catch {
    return { blocked: true, reason: "unavailable" };
  }
}

export const OPT_OUT_MESSAGE = "This contact has texted STOP, so text messages are blocked.";
export const OPT_OUT_UNAVAILABLE_MESSAGE = "Text opt-out status could not be checked, so the text was not sent.";
