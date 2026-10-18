import { WEBSITE_URL } from "./website-rest.ts";
import type { DueLead } from "./followup-scan.ts";

export const SCAN_PAGE_SIZE = 500;
export const SCAN_MAX_PAGES = 10;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nullableText = (value: unknown) => value === null || typeof value === "string";

export async function readWebsiteFollowups(secret: string, request: typeof fetch = fetch) {
  if (!secret) throw new Error("Website scan credential unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const leads: DueLead[] = [];
  const cursors = new Set<string>();
  const ids = new Set<string>();
  let cursor: string | null = null;
  let scanned = 0;
  let paused = false;
  let lastId = "";
  try {
    for (let page = 0; page < SCAN_MAX_PAGES; page++) {
      let response: Response;
      try {
        response = await request(`${WEBSITE_URL}/functions/v1/crm-readonly-scan`, {
          method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", "x-shared-secret": secret },
          body: JSON.stringify({ cursor, limit: SCAN_PAGE_SIZE }),
        });
      } catch { throw new Error("Website scan transport unavailable"); }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Website scan rejected (${response.status})`);
      }
      let data: unknown;
      try { data = await response.json(); } catch { throw new Error("Invalid website scan response"); }
      if (!record(data) || data.success !== true || data.contract !== "website-crm-read-v1" ||
        data.sending_enabled !== false || data.sent !== 0 || !record(data.marketing_settings) ||
        data.marketing_settings.id !== true || typeof data.marketing_settings.marketing_paused !== "boolean" ||
        !Array.isArray(data.leads) || !Number.isInteger(data.scanned) ||
        typeof data.scanned !== "number" || data.scanned < 0 || data.scanned > SCAN_PAGE_SIZE ||
        data.leads.length > data.scanned ||
        !(data.next_cursor === null || (typeof data.next_cursor === "string" && data.next_cursor.length > 0 && data.next_cursor.length <= 128))) {
        throw new Error("Invalid website scan response");
      }
      for (const lead of data.leads) {
        if (!record(lead) || typeof lead.id !== "string" || !uuid.test(lead.id) ||
          lead.id <= lastId || ids.has(lead.id) || !nullableText(lead.name) ||
          !nullableText(lead.email) || !nullableText(lead.phone) || typeof lead.do_not_email !== "boolean" ||
          lead.raw_payload !== null || !record(lead.client_profile)) {
          throw new Error("Invalid website scan lead");
        }
        lastId = lead.id;
        ids.add(lead.id);
        leads.push(lead as unknown as DueLead);
      }
      scanned += data.scanned;
      // A pause observed on any page is sticky for this inspection, never send authorization.
      paused ||= data.marketing_settings.marketing_paused;
      if (data.next_cursor === null) return { leads, scanned, paused, pages: page + 1 };
      if (data.scanned === 0 || cursors.has(data.next_cursor)) throw new Error("Website scan cursor did not progress");
      cursors.add(data.next_cursor);
      cursor = data.next_cursor;
    }
    throw new Error("Website scan incomplete: page budget exhausted");
  } finally { clearTimeout(timer); }
}