import { describe, expect, it, vi } from "vitest";
import { marketingEmailAllowed, MARKETING_BLOCKED } from "../../supabase/functions/_shared/marketing-policy";
import { inspectScheduledFollowups, isDueFollowup, type DueLead } from "../../supabase/functions/_shared/followup-scan";

const auth = { apiKey: "mock-key", token: "mock-staff-token" };
const now = Date.parse("2026-10-17T18:51:00Z");
const lead: DueLead = {
  id: "mock-lead", name: "Test", email: "test@example.test", phone: null,
  do_not_email: false, raw_payload: null,
  client_profile: { followup_auto_send: true, followup_status: "Pending", followup_type: "email", followup_date: "2026-10-17T18:00:00Z" },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe("global CRM marketing email pause", () => {
  it.each([
    ["paused", [{ marketing_paused: true }]],
    ["missing singleton", []],
    ["null", [{ marketing_paused: null }]],
    ["string false", [{ marketing_paused: "false" }]],
    ["missing value", [{}]],
    ["duplicate settings", [{ marketing_paused: false }, { marketing_paused: false }]],
    ["wrong envelope", { marketing_paused: false }],
  ])("blocks when %s", async (_label, rows) => {
    expect(await marketingEmailAllowed(auth, vi.fn().mockResolvedValue(json(rows)))).toBe(false);
  });

  it("allows only the explicit false singleton and uses staff auth", async () => {
    const request = vi.fn().mockResolvedValue(json([{ marketing_paused: false }]));
    expect(await marketingEmailAllowed(auth, request)).toBe(true);
    expect(request).toHaveBeenCalledWith(expect.stringContaining("email_marketing_settings?select=marketing_paused&id=eq.true"), expect.objectContaining({
      method: "GET", cache: "no-store", headers: { apikey: "mock-key", Authorization: "Bearer mock-staff-token" },
    }));
  });

  it.each([401, 403, 404, 500])("fails closed on HTTP %s", async status => {
    expect(await marketingEmailAllowed(auth, vi.fn().mockResolvedValue(json([], status)))).toBe(false);
  });

  it.each([new Error("offline"), new DOMException("timeout", "TimeoutError")])("fails closed on read exceptions", async error => {
    expect(await marketingEmailAllowed(auth, vi.fn().mockRejectedValue(error))).toBe(false);
  });

  it("fails closed on malformed JSON and missing credentials", async () => {
    expect(await marketingEmailAllowed(auth, vi.fn().mockResolvedValue(new Response("not JSON")))).toBe(false);
    const request = vi.fn();
    expect(await marketingEmailAllowed({ apiKey: "", token: "" }, request)).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not cache an earlier unpaused result", async () => {
    const request = vi.fn().mockResolvedValueOnce(json([{ marketing_paused: false }])).mockResolvedValueOnce(json([{ marketing_paused: true }]));
    expect(await marketingEmailAllowed(auth, request)).toBe(true);
    expect(await marketingEmailAllowed(auth, request)).toBe(false);
    expect(MARKETING_BLOCKED).toMatchObject({ success: false, paused: true, sent: 0 });
  });
});

describe("scheduled follow-up repair remains non-sending", () => {
  it("replaces the missing proxy with authenticated GETs, with zero writes or sends even unpaused", async () => {
    const request = vi.fn().mockImplementation(async (url: string) =>
      json(url.includes("email_marketing_settings") ? [{ marketing_paused: false }] : [lead]));
    const result = await inspectScheduledFollowups(auth, now, request);
    expect(result).toMatchObject({ success: true, dry_run: true, sending_enabled: false, scanned: 1, sent: 0, due_email: 1, due_sms: 0 });
    expect(request).toHaveBeenCalledTimes(2);
    for (const [url, options] of request.mock.calls) {
      expect(url).not.toContain("functions/v1");
      expect(options.method).toBe("GET");
    }
  });

  it("counts suppressed emails but preserves pending records", async () => {
    const request = vi.fn().mockImplementation(async (url: string) => json(url.includes("email_marketing_settings") ? [{ marketing_paused: true }] : [lead]));
    expect(await inspectScheduledFollowups(auth, now, request)).toMatchObject({ marketing_paused: true, suppressed_email: 1, sent: 0 });
    expect(lead.client_profile?.followup_status).toBe("Pending");
  });

  it("does not mistake credential failure for an empty successful queue", async () => {
    await expect(inspectScheduledFollowups(auth, now, vi.fn().mockResolvedValue(json([], 401)))).rejects.toThrow("Website read rejected (401)");
  });

  it("paginates deterministically beyond 1000 leads", async () => {
    const request = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("email_marketing_settings")) return json([{ marketing_paused: false }]);
      return json(url.includes("offset=1000") ? [{ ...lead, id: "last" }] : Array.from({ length: 1000 }, (_, i) => ({ ...lead, id: `lead-${i}` })));
    });
    expect((await inspectScheduledFollowups(auth, now, request)).scanned).toBe(1001);
    expect(request.mock.calls[2][0]).toContain("offset=1000");
  });

  it.each([
    { followup_sent_at: "2026-10-17T17:00:00Z" },
    { followup_status: "Sent" },
    { followup_auto_send: false },
    { followup_type: "phone" },
    { followup_date: "2026-10-18T18:00:00Z" },
    { followup_date: "invalid" },
  ])("excludes ineligible follow-ups %j", async patch => {
    expect(isDueFollowup({ ...lead, client_profile: { ...lead.client_profile, ...patch } }, now)).toBe(false);
  });
});