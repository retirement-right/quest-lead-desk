import { readWebsiteFollowups } from "./website-followup-scan.ts";

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

// Deliberately read-only. Request bodies cannot turn sending on. The next release
// must introduce an explicitly authorized dispatch path with atomic claims shared
// with browser dispatch; until then cron cannot release a backlog or double-send.
export async function inspectScheduledFollowups(
  secret: string,
  now = Date.now(),
  request: typeof fetch = fetch,
) {
  const scan = await readWebsiteFollowups(secret, request);
  const allowed = !scan.paused;
  const leads = scan.leads.filter(lead => isDueFollowup(lead, now));
  const emails = leads.filter(lead => String(lead.client_profile?.followup_type).toLowerCase() === "email");
  return {
    success: true,
    dry_run: true,
    sending_enabled: false,
    scan_complete: true,
    scanned: scan.scanned,
    pages: scan.pages,
    due: leads.length,
    due_email: emails.length,
    due_sms: leads.length - emails.length,
    marketing_paused: !allowed,
    suppressed_email: emails.filter(lead => !allowed || lead.do_not_email === true).length,
    sent: 0,
    skipped: leads.length,
    errors: [] as string[],
  };
}