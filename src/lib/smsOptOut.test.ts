// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { checkSmsOptOut, decideOptOut, keywordOf } from "../../supabase/functions/_shared/sms-opt-out";

const phone = "+14805550100";
function client(activity: unknown, unmatched: unknown, error: unknown = null) {
  const calls: unknown[][] = [];
  const chain = (data: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) q[m] = (...a: unknown[]) => { calls.push([m, ...a]); return q; };
    q.limit = async () => ({ data, error });
    return q;
  };
  const from = vi.fn((t: string) => {
    if (t === "contact_activity") return chain(activity);
    if (t === "inbound_sms_unmatched") return chain(unmatched);
    throw new Error("unexpected table");
  });
  return { from, calls };
}

describe("manual SMS opt-out guard (simulated stored inbound texts, no sends)", () => {
  it.each(["STOP", "stop", " Stop. ", "UNSUBSCRIBE", "cancel", "END", "QUIT", "STOPALL", "opt out"])("treats %s as opt-out", k =>
    expect(keywordOf(k)).toBe("out"));
  it.each(["START", "unstop", "Yes"])("treats %s as opt-in", k => expect(keywordOf(k)).toBe("in"));
  it.each(["please stop calling me later", "Thanks!", "", null])("ignores non-keyword %j", k => expect(keywordOf(k)).toBeNull());

  it("blocks when a matched contact texted STOP", async () =>
    expect(await checkSmsOptOut(client([{ body: "STOP", created_at: "2026-10-01T00:00:00Z" }], []), phone)).toEqual({ blocked: true, reason: "opted_out" }));
  it("blocks when STOP arrived only in the unmatched inbox", async () =>
    expect(await checkSmsOptOut(client([], [{ body: "stop", received_at: "2026-10-01T00:00:00Z" }]), phone)).toEqual({ blocked: true, reason: "opted_out" }));
  it("allows after a later START", () =>
    expect(decideOptOut([{ body: "STOP", at: "2026-10-01T00:00:00Z" }, { body: "START", at: "2026-10-02T00:00:00Z" }])).toEqual({ blocked: false }));
  it("blocks again after STOP following START", () =>
    expect(decideOptOut([{ body: "START", at: "2026-10-02T00:00:00Z" }, { body: "STOP", at: "2026-10-03T00:00:00Z" }])).toEqual({ blocked: true, reason: "opted_out" }));
  it("allows a contact with only ordinary replies", async () =>
    expect(await checkSmsOptOut(client([{ body: "See you Tuesday", created_at: "2026-10-01T00:00:00Z" }], []), phone)).toEqual({ blocked: false }));
  it("reads only inbound texts from the exact recipient number", async () => {
    const c = client([], []);
    await checkSmsOptOut(c, phone);
    expect(c.calls).toContainEqual(["eq", "direction", "inbound"]);
    expect(c.calls).toContainEqual(["eq", "sender", phone]);
    expect(c.calls).toContainEqual(["eq", "from_number", phone]);
  });
  it("fails closed on a lookup error", async () =>
    expect(await checkSmsOptOut(client([], [], { message: "down" }), phone)).toEqual({ blocked: true, reason: "unavailable" }));
  it("fails closed on malformed replies", async () =>
    expect(await checkSmsOptOut(client(null, []), phone)).toEqual({ blocked: true, reason: "unavailable" }));
  it("fails closed when storage is unavailable", async () =>
    expect(await checkSmsOptOut(null, phone)).toEqual({ blocked: true, reason: "unavailable" }));
  it("fails closed on an invalid number", async () =>
    expect(await checkSmsOptOut(client([], []), "4805550100")).toEqual({ blocked: true, reason: "unavailable" }));
  it("fails closed on an unreadable STOP timestamp", () =>
    expect(decideOptOut([{ body: "STOP", at: "not-a-date" }])).toEqual({ blocked: true, reason: "unavailable" }));
});
