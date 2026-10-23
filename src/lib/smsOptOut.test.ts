// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { checkSmsOptOut, decideOptOut, keywordOf, normalizeSmsPhone } from "../../supabase/functions/_shared/sms-opt-out";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll } from "vitest";

const phone = "+14805550100";
function client(data: unknown = "allowed", error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) };
}

describe("manual SMS opt-out guard (simulated stored inbound texts, no sends)", () => {
  it.each(["STOP", "stop", " Stop. ", "UNSUBSCRIBE", "cancel", "END", "QUIT", "STOPALL", "opt out"])("treats %s as opt-out", k =>
    expect(keywordOf(k)).toBe("out"));
  it.each(["START", "unstop", "Yes"])("treats %s as opt-in", k => expect(keywordOf(k)).toBe("in"));
  it.each(["please stop calling me later", "Thanks!", "", null])("ignores non-keyword %j", k => expect(keywordOf(k)).toBeNull());

  it("blocks when a matched contact texted STOP", async () =>
    expect(await checkSmsOptOut(client("opted_out"), phone)).toEqual({ blocked: true, reason: "opted_out" }));
  it("blocks when STOP arrived only in the unmatched inbox", async () =>
    expect(await checkSmsOptOut(client("opted_out"), phone)).toEqual({ blocked: true, reason: "opted_out" }));
  it("allows after a later START", () =>
    expect(decideOptOut([{ body: "STOP", at: "2026-10-01T00:00:00Z" }, { body: "START", at: "2026-10-02T00:00:00Z" }])).toEqual({ blocked: false }));
  it("blocks again after STOP following START", () =>
    expect(decideOptOut([{ body: "START", at: "2026-10-02T00:00:00Z" }, { body: "STOP", at: "2026-10-03T00:00:00Z" }])).toEqual({ blocked: true, reason: "opted_out" }));
  it("allows a contact with only ordinary replies", async () =>
    expect(await checkSmsOptOut(client(), phone)).toEqual({ blocked: false }));
  it("reads only inbound texts from the exact recipient number", async () => {
    const c = client();
    await checkSmsOptOut(c, phone);
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith("sms_opt_out_status", { _phone: phone });
  });
  it("fails closed on a lookup error", async () =>
    expect(await checkSmsOptOut(client("allowed", { message: "down" }), phone)).toEqual({ blocked: true, reason: "unavailable" }));
  it("fails closed on malformed replies", async () =>
    expect(await checkSmsOptOut(client(null), phone)).toEqual({ blocked: true, reason: "unavailable" }));
  it("fails closed when storage is unavailable", async () =>
    expect(await checkSmsOptOut(null, phone)).toEqual({ blocked: true, reason: "unavailable" }));
  it("fails closed on an invalid number", async () =>
    expect(await checkSmsOptOut(client(), "+000")).toEqual({ blocked: true, reason: "unavailable" }));
  it("fails closed on an unreadable STOP timestamp", () =>
    expect(decideOptOut([{ body: "STOP", at: "not-a-date" }])).toEqual({ blocked: true, reason: "unavailable" }));
  it("normalizes formatted US numbers before lookup", async () => {
    const c = client();
    await checkSmsOptOut(c, "(480) 555-0100");
    expect(c.rpc).toHaveBeenCalledWith("sms_opt_out_status", { _phone: phone });
    expect(normalizeSmsPhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("fails closed on exceptions", async () => {
    expect(await checkSmsOptOut({ rpc: async () => { throw new Error("offline"); } }, phone)).toEqual({ blocked: true, reason: "unavailable" });
  });
});

describe("indexed authoritative consent RPC in isolated PostgreSQL, no production data", () => {
  const db = new PGlite();
  const read = async (number: string) => (await db.query<{ status: string }>("SELECT public.sms_opt_out_status($1) AS status", [number])).rows[0]?.status;
  beforeAll(async () => {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE public.contact_activity (sender text, direction text, body text, created_at timestamptz); CREATE TABLE public.inbound_sms_unmatched (from_number text, body text, received_at timestamptz);");
    await db.exec(readFileSync("docs/sms-opt-out-query.sql", "utf8"));
  });
  afterAll(async () => { await db.close(); });
  it.each(["contact_activity", "inbound_sms_unmatched"])("does not miss STOP behind 250 newer ordinary replies in %s", async table => {
    const sender = table === "contact_activity" ? "+14805550101" : "+14805550102";
    if (table === "contact_activity") {
      await db.query("INSERT INTO public.contact_activity VALUES($1,'inbound','STOP','2026-01-01'); INSERT INTO public.contact_activity SELECT $1,'inbound','ordinary reply','2026-01-02'::timestamptz + n*interval '1 minute' FROM generate_series(1,250) n", [sender]);
    } else {
      await db.query("INSERT INTO public.inbound_sms_unmatched VALUES($1,'STOP','2026-01-01'); INSERT INTO public.inbound_sms_unmatched SELECT $1,'ordinary reply','2026-01-02'::timestamptz + n*interval '1 minute' FROM generate_series(1,250) n", [sender]);
    }
    expect(await read(sender)).toBe("opted_out");
  });
  it("uses latest keyword across sources and normalized phones", async () => {
    await db.exec("INSERT INTO public.contact_activity VALUES('(480) 555-0103','inbound','STOP','2026-01-01'); INSERT INTO public.inbound_sms_unmatched VALUES('+1 480 555 0103','START','2026-01-02');");
    expect(await read("+14805550103")).toBe("allowed");
    await db.exec("INSERT INTO public.contact_activity VALUES('+14805550103','inbound','OPT OUT!','2026-01-03');");
    expect(await read("4805550103")).toBe("opted_out");
  });
  it("STOP wins equal timestamp ties within and across sources", async () => {
    await db.exec("INSERT INTO public.contact_activity VALUES('+14805550104','inbound','START','2026-01-01'),('+14805550104','inbound','STOP','2026-01-01'); INSERT INTO public.inbound_sms_unmatched VALUES('+14805550104','YES','2026-01-01');");
    expect(await read("+14805550104")).toBe("opted_out");
  });
  it("ignores other phones and outbound keywords", async () => {
    await db.exec("INSERT INTO public.contact_activity VALUES('+14805550105','outbound','STOP','2026-01-01'),('+14805550106','inbound','STOP','2026-01-01');");
    expect(await read("+14805550105")).toBe("allowed");
  });
  it("rejects invalid phone rather than returning permission", async () => {
    await expect(read("bad")).rejects.toThrow("Invalid SMS recipient");
  });
  it("denies anonymous/authenticated RPC calls while preserving service execution", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      try { await expect(read(phone)).rejects.toThrow("permission denied"); }
      finally { await db.exec("RESET ROLE"); }
    }
    await db.exec("SET ROLE service_role");
    try { expect(await read(phone)).toBe("allowed"); } finally { await db.exec("RESET ROLE"); }
  });
});
