import { describe, expect, it, vi } from "vitest";
import { marketingEmailAllowed, MARKETING_BLOCKED } from "../../supabase/functions/_shared/marketing-policy";

const auth = { apiKey: "mock-key", token: "mock-staff-token" };
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

