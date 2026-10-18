// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { emailRecipientAllowed } from "../../supabase/functions/_shared/email-suppression";

type Handler = (req: Request) => Promise<Response>;
function receiver(secret: string | undefined = "mock-shared-secret") {
  const exports: { createReceiver?: (deps: unknown) => Handler } = {};
  const source = readFileSync("supabase/functions/receive-website-event/handler.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  runInNewContext(compiled, { exports, Response, TextDecoder, Uint8Array,
    require: (name: string) => {
      if (name === "npm:zod@3") return { z };
      if (name === "npm:@supabase/supabase-js@2/cors") return { corsHeaders: {} };
      throw new Error(`Unmocked dependency ${name}`);
    },
  });
  const store = vi.fn().mockResolvedValue("accepted");
  if (!exports.createReceiver) throw new Error("Receiver missing");
  return { handler: exports.createReceiver({ secret: () => secret, store }), store };
}
const id = "00000000-0000-4000-8000-000000000001";
const checkin = { email: "Test@Example.test", name: "Test", lead_id: null, event_id: null, event_name: null, event_date: "2026-10-18", checked_in_at: "2026-10-18T18:00:00+00:00", guest_checked_in_at: null, guest_name: null, source: "retirement_right_admin_checkin", delivery_id: id, event_idempotency_key: "attendees:test:checked_in_at:2026-10-18" };
const unsubscribe = { email: "Test@Example.test", group: "Newsletter", unsubscribed_at: "2026-10-18T18:00:00+00:00", source: "retirement_right_local_unsubscribe", delivery_id: id, event_idempotency_key: "newsletter_unsubscribes:test:unsubscribe" };
const req = (body: unknown = checkin, secret = "mock-shared-secret", key = (body as typeof checkin).event_idempotency_key) => new Request("https://crm.example.test/receive-website-event", { method: "POST", headers: { "Content-Type": "application/json", "x-shared-secret": secret, "Idempotency-Key": key }, body: JSON.stringify(body) });

describe("authenticated website receiver, no network or sends", () => {
  it.each(["", "wrong-secret"])("rejects missing/wrong shared secret before writes", async secret => {
    const mock = receiver();
    expect((await mock.handler(req(checkin, secret))).status).toBe(401);
    expect(mock.store).not.toHaveBeenCalled();
  });
  it("fails closed with unconfigured authentication", async () => {
    const mock = receiver("");
    expect((await mock.handler(req())).status).toBe(503);
    expect(mock.store).not.toHaveBeenCalled();
  });
  it.each([checkin, unsubscribe])("accepts actual website payload and holds it without sends", async event => {
    const mock = receiver();
    expect(await (await mock.handler(req(event))).json()).toMatchObject({ success: true, held: true, sending_enabled: false, sent: 0, suppression_applied: event === unsubscribe });
    expect(mock.store).toHaveBeenCalledWith(expect.objectContaining({ email: "test@example.test", eventType: event === unsubscribe ? "unsubscribe" : "checkin" }));
  });
  it("rejects mismatched header/body idempotency keys", async () => {
    const mock = receiver();
    expect((await mock.handler(req(checkin, "mock-shared-secret", "other"))).status).toBe(400);
    expect(mock.store).not.toHaveBeenCalled();
  });
  it.each([
    { ...checkin, followup_auto_send: true },
    { ...checkin, source: "unknown" },
    { ...checkin, email: "bad" },
    { ...checkin, checked_in_at: null },
    { ...unsubscribe, unsubscribed_at: "bad" },
  ])("rejects malformed events and automation enrollment", async event => {
    const mock = receiver();
    expect((await mock.handler(req(event))).status).toBe(400);
    expect(mock.store).not.toHaveBeenCalled();
  });
  it("rejects oversized payloads even without Content-Length", async () => {
    const mock = receiver();
    expect((await mock.handler(req({ ...checkin, name: "x".repeat(17000) }))).status).toBe(413);
    expect(mock.store).not.toHaveBeenCalled();
  });
  it("returns 503 rather than acknowledgment when persistence fails", async () => {
    const mock = receiver(); mock.store.mockRejectedValue(new Error("private failure"));
    const response = await mock.handler(req());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private failure");
  });
  it("acknowledges duplicate retry but rejects conflicting reuse", async () => {
    const mock = receiver(); mock.store.mockResolvedValueOnce("duplicate").mockResolvedValueOnce("conflict");
    expect(await (await mock.handler(req())).json()).toMatchObject({ success: true, status: "duplicate" });
    expect((await mock.handler(req())).status).toBe(409);
  });
  it("authenticated GET capability probe never writes", async () => {
    const mock = receiver();
    const response = await mock.handler(new Request("https://crm.example.test/receive-website-event", { headers: { "x-shared-secret": "mock-shared-secret" } }));
    expect(await response.json()).toMatchObject({ contract: "website-events-v1", sending_enabled: false, sent: 0 });
    expect(mock.store).not.toHaveBeenCalled();
  });
});

describe("strict recipient suppression", () => {
  it("normalizes recipient and permits only successful explicit no-suppression read", async () => {
    const read = vi.fn().mockResolvedValue({ blocked: false, error: false });
    expect(await emailRecipientAllowed(" Test@Example.test ", read)).toBe(true);
    expect(read).toHaveBeenCalledWith("test@example.test");
  });
  it.each([{ blocked: true, error: false }, { blocked: false, error: true }])("fails closed for suppression or failed read", async result => {
    expect(await emailRecipientAllowed("test@example.test", async () => result)).toBe(false);
  });
  it("fails closed on timeout/exception", async () => {
    expect(await emailRecipientAllowed("test@example.test", async () => { throw new Error("timeout"); })).toBe(false);
  });
});

describe("actual migration in isolated PostgreSQL, never production", () => {
  let db: PGlite;
  const accept = (key: string, type: string, payload: Record<string, unknown>) => db.query<{ result: string }>("SELECT public.accept_website_event($1,$2,$3,$4,$5::jsonb) AS result", [key, id, type, payload.email, JSON.stringify(payload)]);
  const payload = { email: "sql@example.test", source: "retirement_right_local_unsubscribe", group: "Newsletter", unsubscribed_at: "2026-10-18T18:00:00Z" };
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
    await db.exec(readFileSync("drizzle/migrations/0000_held_crm_website_event_receiver.sql", "utf8"));
  }, 30000);
  afterAll(async () => { await db?.close(); });
  it("atomically stores unsubscribe and sticky suppression", async () => {
    expect((await accept("sql-unsubscribe", "unsubscribe", payload)).rows[0].result).toBe("accepted");
    expect((await db.query("SELECT email FROM public.crm_email_suppressions")).rows).toEqual([{ email: "sql@example.test" }]);
  });
  it("duplicate retries on an isolated single connection create one event", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => accept("sql-unsubscribe", "unsubscribe", payload)));
    expect(results.every(result => result.rows[0].result === "duplicate")).toBe(true);
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.crm_website_events WHERE event_key='sql-unsubscribe'")).rows[0].count).toBe(1);
  });
  it("rejects changed-content reuse without creating suppression for another email", async () => {
    expect((await accept("sql-unsubscribe", "unsubscribe", { ...payload, email: "other@example.test" })).rows[0].result).toBe("conflict");
    expect((await db.query("SELECT email FROM public.crm_email_suppressions WHERE email='other@example.test'")).rows).toEqual([]);
  });
  it("later check-in remains held and cannot restore consent", async () => {
    expect((await accept("sql-checkin", "checkin", { email: "sql@example.test", source: "retirement_right_admin_checkin", checked_in_at: "2026-10-18T18:00:00Z" })).rows[0].result).toBe("accepted");
    expect((await db.query("SELECT email FROM public.crm_email_suppressions WHERE email='sql@example.test'")).rows).toHaveLength(1);
    expect((await db.query("SELECT DISTINCT status FROM public.crm_website_events")).rows).toEqual([{ status: "held" }]);
  });
  it("storage failure rolls back event and suppression atomically", async () => {
    await db.exec("CREATE FUNCTION fail_suppression() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'mock failure'; END $$; CREATE TRIGGER test_fail BEFORE INSERT ON public.crm_email_suppressions FOR EACH ROW EXECUTE FUNCTION fail_suppression();");
    await expect(accept("sql-rollback", "unsubscribe", { ...payload, email: "rollback@example.test" })).rejects.toThrow("mock failure");
    expect((await db.query("SELECT event_key FROM public.crm_website_events WHERE event_key='sql-rollback'")).rows).toEqual([]);
    await db.exec("DROP TRIGGER test_fail ON public.crm_email_suppressions;");
  });
  it("anonymous and authenticated clients cannot read/write inbox or execute receiver RPC", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(db.query("SELECT * FROM public.crm_website_events")).rejects.toThrow("permission denied");
        await expect(accept("blocked", "unsubscribe", payload)).rejects.toThrow("permission denied");
        await expect(db.query("SELECT * FROM public.crm_email_suppressions")).rejects.toThrow("permission denied");
      } finally { await db.exec("RESET ROLE"); }
    }
  });
});