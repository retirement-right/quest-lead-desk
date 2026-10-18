import { describe, expect, it, vi } from "vitest";
import { inspectScheduledFollowups, isDueFollowup, type DueLead } from "../../supabase/functions/_shared/followup-scan";
import { readWebsiteFollowups, SCAN_MAX_PAGES } from "../../supabase/functions/_shared/website-followup-scan";

const now = Date.parse("2026-10-18T22:14:00Z");
const lead: DueLead = {
  id: "00000000-0000-4000-8000-000000000001", name: "Fixture", email: "fixture@example.test", phone: null,
  do_not_email: false, raw_payload: null,
  client_profile: { followup_auto_send: true, followup_status: "Pending", followup_type: "email", followup_date: "2026-10-18T18:00:00Z" },
};
const envelope = (patch: Record<string, unknown> = {}) => ({ success: true, contract: "website-crm-read-v1",
  marketing_settings: { id: true, marketing_paused: true }, leads: [lead], scanned: 1,
  next_cursor: null, sending_enabled: false, sent: 0, ...patch });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const secret = "mock-private-secret";

describe("authenticated bounded website scheduler scan", () => {
  it("uses only the documented shared-secret POST and remains held when unpaused", async () => {
    const request = vi.fn().mockResolvedValue(json(envelope({ marketing_settings: { id: true, marketing_paused: false } })));
    const before = JSON.stringify(lead);
    expect(await inspectScheduledFollowups(secret, now, request)).toMatchObject({ success: true, scan_complete: true,
      dry_run: true, sending_enabled: false, sent: 0, scanned: 1, due: 1, due_email: 1, due_sms: 0, skipped: 1, marketing_paused: false });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.stringMatching(/\/functions\/v1\/crm-readonly-scan$/), expect.objectContaining({
      method: "POST", redirect: "error", cache: "no-store", headers: { "Content-Type": "application/json", "x-shared-secret": secret },
      body: '{"cursor":null,"limit":500}', signal: expect.any(AbortSignal),
    }));
    expect(JSON.stringify(lead)).toBe(before);
  });
  it("counts paused and opted-out email observations without writes or sends", async () => {
    const request = vi.fn().mockResolvedValue(json(envelope()));
    expect(await inspectScheduledFollowups(secret, now, request)).toMatchObject({ marketing_paused: true, suppressed_email: 1, sent: 0 });
    const optedOut = { ...lead, do_not_email: true };
    expect(await inspectScheduledFollowups(secret, now, vi.fn().mockResolvedValue(json(envelope({ leads: [optedOut],
      marketing_settings: { id: true, marketing_paused: false } }))))).toMatchObject({ suppressed_email: 1, sent: 0 });
  });
  it("continues empty due pages until a null cursor, counting scanned profiles separately", async () => {
    const request = vi.fn().mockResolvedValueOnce(json(envelope({ leads: [], scanned: 500, next_cursor: "opaque-cursor" })))
      .mockResolvedValueOnce(json(envelope()));
    expect(await inspectScheduledFollowups(secret, now, request)).toMatchObject({ scanned: 501, due: 1, pages: 2 });
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ cursor: "opaque-cursor", limit: 500 });
  });
  it("keeps a pause observed on an earlier page sticky", async () => {
    const request = vi.fn().mockResolvedValueOnce(json(envelope({ leads: [], next_cursor: "next" })))
      .mockResolvedValueOnce(json(envelope({ marketing_settings: { id: true, marketing_paused: false } })));
    expect(await inspectScheduledFollowups(secret, now, request)).toMatchObject({ marketing_paused: true, suppressed_email: 1, sending_enabled: false });
  });
  it("accepts a genuinely empty completed queue", async () => {
    expect(await inspectScheduledFollowups(secret, now, vi.fn().mockResolvedValue(json(envelope({ leads: [], scanned: 0 })))))
      .toMatchObject({ success: true, scanned: 0, due: 0, scan_complete: true, sent: 0 });
  });
  it.each([401, 403, 404, 503])("rejects HTTP %s without leaking upstream bodies", async status => {
    await expect(readWebsiteFollowups(secret, vi.fn().mockResolvedValue(json({ error: secret }, status))))
      .rejects.toThrow(`Website scan rejected (${status})`);
  });
  it("blocks missing credentials before any request", async () => {
    const request = vi.fn();
    await expect(readWebsiteFollowups("", request)).rejects.toThrow("credential unavailable");
    expect(request).not.toHaveBeenCalled();
  });
  it("sanitizes network errors and redirects", async () => {
    await expect(readWebsiteFollowups(secret, vi.fn().mockRejectedValue(new Error(secret))))
      .rejects.toThrow("Website scan transport unavailable");
  });
  it("aborts its total read budget", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("timeout")));
      }));
      const result = expect(readWebsiteFollowups(secret, request)).rejects.toThrow("transport unavailable");
      await vi.advanceTimersByTimeAsync(20000);
      await result;
      expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("rejects malformed JSON", async () => {
    await expect(readWebsiteFollowups(secret, vi.fn().mockResolvedValue(new Response("bad JSON"))))
      .rejects.toThrow("Invalid website scan response");
  });
  it.each([
    { success: false }, { contract: "wrong" }, { sending_enabled: true }, { sent: 1 },
    { marketing_settings: null }, { marketing_settings: { id: false, marketing_paused: false } },
    { marketing_settings: { id: true, marketing_paused: "false" } }, { marketing_settings: { id: true } },
    { marketing_settings: { id: true, marketing_paused: null } }, { leads: null },
    { scanned: 501 }, { scanned: -1 }, { scanned: 1.5 }, { scanned: "1" }, { scanned: 0 },
    { next_cursor: "" }, { next_cursor: 3 }, { next_cursor: "x".repeat(129) }, { next_cursor: undefined },
  ])("rejects malformed or unsafe envelope %j", async patch => {
    await expect(readWebsiteFollowups(secret, vi.fn().mockResolvedValue(json(envelope(patch)))))
      .rejects.toThrow("Invalid website scan response");
  });
  it.each([{ id: "bad" }, { name: 42 }, { email: {} }, { phone: false }, { do_not_email: null },
    { raw_payload: {} }, { client_profile: null }, { client_profile: [] }])("rejects malformed lead %j", async patch => {
    await expect(readWebsiteFollowups(secret, vi.fn().mockResolvedValue(json(envelope({ leads: [{ ...lead, ...patch }] })))))
      .rejects.toThrow("Invalid website scan lead");
  });
  it("rejects duplicate IDs across pages", async () => {
    const request = vi.fn().mockResolvedValueOnce(json(envelope({ next_cursor: "a" }))).mockResolvedValueOnce(json(envelope()));
    await expect(readWebsiteFollowups(secret, request)).rejects.toThrow("Invalid website scan lead");
  });
  it("rejects unordered leads", async () => {
    await expect(readWebsiteFollowups(secret, vi.fn().mockResolvedValue(json(envelope({ scanned: 2,
      leads: [{ ...lead, id: "00000000-0000-4000-8000-000000000002" }, lead] })))))
      .rejects.toThrow("Invalid website scan lead");
  });
  it("rejects repeated and cyclic cursors", async () => {
    const request = vi.fn().mockResolvedValueOnce(json(envelope({ leads: [], next_cursor: "a" })))
      .mockResolvedValueOnce(json(envelope({ leads: [], next_cursor: "b" })))
      .mockResolvedValueOnce(json(envelope({ leads: [], next_cursor: "a" })));
    await expect(readWebsiteFollowups(secret, request)).rejects.toThrow("cursor did not progress");
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("rejects a zero-scan page with continuation", async () => {
    await expect(readWebsiteFollowups(secret, vi.fn().mockResolvedValue(json(envelope({ leads: [], scanned: 0, next_cursor: "a" })))))
      .rejects.toThrow("cursor did not progress");
  });
  it("fails closed when its ten-page / 5000-profile budget is incomplete", async () => {
    let page = 0;
    const request = vi.fn().mockImplementation(async () => json(envelope({ leads: [], scanned: 500, next_cursor: `cursor-${++page}` })));
    await expect(readWebsiteFollowups(secret, request)).rejects.toThrow("page budget exhausted");
    expect(request).toHaveBeenCalledTimes(SCAN_MAX_PAGES);
    expect(SCAN_MAX_PAGES).toBe(10);
  });
  it("discards a successful partial result when a later page fails", async () => {
    const request = vi.fn().mockResolvedValueOnce(json(envelope({ next_cursor: "a" }))).mockResolvedValueOnce(json({}, 503));
    await expect(inspectScheduledFollowups(secret, now, request)).rejects.toThrow("Website scan rejected (503)");
  });
  it.each([
    { followup_sent_at: "2026-10-18T17:00:00Z" }, { followup_status: "Sent" }, { followup_auto_send: false },
    { followup_type: "phone" }, { followup_date: "2026-10-19T18:00:00Z" }, { followup_date: "invalid" },
  ])("defensively excludes ineligible follow-ups %j", patch => {
    expect(isDueFollowup({ ...lead, client_profile: { ...lead.client_profile, ...patch } }, now)).toBe(false);
  });
});