// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const tables = ["birthday_outreach_log", "bookedin_appointments", "contact_activity", "inbound_sms_unmatched", "lead_documents", "internal_secrets"];
const policies: Record<string, string[]> = {
  birthday_outreach_log: ["Authenticated users can view birthday outreach log"],
  bookedin_appointments: ["Authenticated users can view bookedin appointments"],
  contact_activity: ["Authenticated users can insert activity", "Authenticated users can view activity"],
  inbound_sms_unmatched: ["Authenticated users can update unmatched inbound", "Authenticated users can view unmatched inbound"],
  lead_documents: ["Authenticated users can delete lead documents", "Authenticated users can insert lead documents", "Authenticated users can view lead documents"],
};

describe("staged Cloud direct-access lockdown in isolated Postgres (not production)", () => {
  beforeAll(async () => {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA storage; GRANT USAGE ON SCHEMA public,storage TO anon,authenticated,service_role;");
    for (const table of tables) {
      await db.exec(`CREATE TABLE public.${table}(id integer PRIMARY KEY, value text); GRANT ALL ON public.${table} TO anon,authenticated,service_role; ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY; INSERT INTO public.${table} VALUES(1,'preserved fixture');`);
      for (const policy of policies[table] ?? []) {
        await db.exec(`CREATE POLICY "${policy}" ON public.${table} TO authenticated USING(true) WITH CHECK(true);`);
      }
    }
    await db.exec("CREATE TABLE storage.objects(id integer PRIMARY KEY,bucket_id text); GRANT ALL ON storage.objects TO anon,authenticated,service_role; ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; INSERT INTO storage.objects VALUES(1,'lead-documents'),(2,'other-bucket');");
    for (const name of ["Authenticated can read lead documents", "Authenticated can upload lead documents", "Authenticated can delete lead documents"]) {
      await db.exec(`CREATE POLICY "${name}" ON storage.objects TO authenticated USING(bucket_id='lead-documents') WITH CHECK(bucket_id='lead-documents');`);
    }
    await db.exec("CREATE POLICY unrelated_bucket ON storage.objects FOR SELECT TO authenticated USING(bucket_id='other-bucket');");
    await db.exec(readFileSync("docs/crm-access-lockdown.staged.sql", "utf8"));
  });
  afterAll(async () => { await db.close(); });

  it.each(tables)("denies anonymous and authenticated CRUD privileges on %s", async table => {
    for (const role of ["anon", "authenticated"]) {
      for (const action of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const result = await db.query<{ allowed: boolean }>("SELECT has_table_privilege($1,$2,$3) AS allowed", [role, `public.${table}`, action]);
        expect(result.rows[0]?.allowed).toBe(false);
      }
    }
  });
  it.each(tables)("preserves service access and fixture data in %s", async table => {
    await db.exec("SET ROLE service_role");
    try {
      expect((await db.query<{ value: string }>(`SELECT value FROM public.${table}`)).rows).toEqual([{ value: "preserved fixture" }]);
    } finally { await db.exec("RESET ROLE"); }
  });
  it("rejects real direct reads rather than only checking policy text", async () => {
    await db.exec("SET ROLE authenticated");
    try { await expect(db.query("SELECT * FROM public.contact_activity")).rejects.toThrow(/permission denied/); }
    finally { await db.exec("RESET ROLE"); }
  });
  it("prevents callers escalating into service role", async () => {
    await db.exec("SET SESSION AUTHORIZATION authenticated");
    try { await expect(db.exec("SET ROLE service_role")).rejects.toThrow(/permission denied/); }
    finally { await db.exec("RESET SESSION AUTHORIZATION"); }
  });
  it("denies private document reads/deletes/uploads but preserves unrelated bucket policy", async () => {
    await db.exec("SET ROLE authenticated");
    try {
      expect((await db.query("SELECT id FROM storage.objects WHERE bucket_id='lead-documents'")).rows).toEqual([]);
      expect((await db.query("SELECT id FROM storage.objects WHERE bucket_id='other-bucket'")).rows).toEqual([{ id: 2 }]);
      expect((await db.query("DELETE FROM storage.objects WHERE bucket_id='lead-documents' RETURNING id")).rows).toEqual([]);
      await expect(db.exec("INSERT INTO storage.objects VALUES(3,'lead-documents')")).rejects.toThrow(/row-level security/);
    } finally { await db.exec("RESET ROLE"); }
    expect((await db.query("SELECT id FROM storage.objects ORDER BY id")).rows).toEqual([{ id: 1 }, { id: 2 }]);
  });
});