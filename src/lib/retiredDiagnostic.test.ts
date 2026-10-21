import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { retiredDiagnosticHandler } from "../../supabase/functions/debug-leadjig-key/handler";

const SECRET = "eyJhbGciOiJIUzI1NiJ9.payload-section.signature-tail-XYZ";

describe("retired debug-leadjig-key endpoint", () => {
  for (const method of ["GET", "POST", "OPTIONS"]) {
    it(`${method} returns 410 with no secret-derived fields`, async () => {
      const get = vi.fn(() => SECRET);
      (globalThis as any).Deno = { env: { get } };
      const res = retiredDiagnosticHandler(new Request("https://x.test/debug", { method }));
      const text = await res.text();
      expect(res.status).toBe(410);
      expect(get).not.toHaveBeenCalled();
      for (const k of ["len", "head", "tail", "parts"]) expect(text).not.toContain(`"${k}"`);
      expect(text).not.toContain(SECRET.slice(0, 8));
      expect(text).not.toContain(SECRET.slice(-6));
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  }

  it("function source never reads environment credentials", () => {
    for (const f of ["index.ts", "handler.ts"]) {
      const src = readFileSync(`supabase/functions/debug-leadjig-key/${f}`, "utf8");
      expect(src).not.toMatch(/Deno\.env/);
    }
  });
});
