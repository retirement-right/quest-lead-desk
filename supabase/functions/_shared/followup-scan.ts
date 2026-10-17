import { websiteRead, type WebsiteAuth } from "./website-rest.ts";
import { marketingEmailAllowed } from "./marketing-policy.ts";

export interface DueLead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  do_not_email: boolean | null;
  raw_payload: Record<string, unknown> | null;
  client_profile: Record<string, unknown> | null;
}

export function isDueFollowup(lead: DueLead, now: number): boolean {
  const cp = lead.client_profile;
  if (!cp || cp.followup_auto_send !== true ||
    (cp.followup_status ?? "Pending") !== "Pending" || cp.followup_sent_at) return false;
  const channel = String(cp.followup_type ?? "").toLowerCase();
  if (channel !== "email" && channel !== "sms") return false;
  const date = typeof cp.followup_date === "string" ? Date.parse(cp.followup_date) : NaN;
  return Number.isFinite(date) && date <= now;
}

export async function listDueFollowups(
  auth: WebsiteAuth,
  now: number,
  request: typeof fetch = fetch,
): Promise<DueLead[]> {
  const due: DueLead[] = [];
  const size = 1000;
  for (let offset = 0; ; offset += size) {
    const rows = await websiteRead(
      `leadjig_leads?select=id,name,email,phone,do_not_email,raw_payload,client_profile&client_profile=not.is.null&order=id.asc&limit=${size}&offset=${offset}`,
      auth,
      request,
    );
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== "string")) {
      throw new Error("Invalid website follow-up response");
    }
    due.push(...(rows as DueLead[]).filter(row => isDueFollowup(row, now)));
    if (rows.length < size) return due;
  }
}

// Deliberately read-only. Request bodies cannot turn sending on. The next release
// must introduce an explicitly authorized dispatch path with atomic claims shared
// with browser dispatch; until then cron cannot release a backlog or double-send.
export async function inspectScheduledFollowups(
  auth: WebsiteAuth,
  now = Date.now(),
  request: typeof fetch = fetch,
) {
  const allowed = await marketingEmailAllowed(auth, request);
  const leads = await listDueFollowups(auth, now, request);
  const emails = leads.filter(lead => String(lead.client_profile?.followup_type).toLowerCase() === "email");
  return {
    success: true,
    dry_run: true,
    sending_enabled: false,
    scanned: leads.length,
    due_email: emails.length,
    due_sms: leads.length - emails.length,
    marketing_paused: !allowed,
    suppressed_email: emails.filter(lead => !allowed || lead.do_not_email === true).length,
    sent: 0,
    skipped: leads.length,
    errors: [] as string[],
  };
}