// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

function isolated(blocked: boolean) {
  const send = vi.fn(async () => new Response(null, { status: 201 }));
  const consent = vi.fn(async () => ({ blocked }));
  const exports: Record<string, (name: string) => Promise<void>> = {};
  const source = ts.transpileModule(readFileSync("supabase/functions/_shared/admin-notify.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  runInNewContext(source, { exports, fetch: send, Response, Date, URLSearchParams, btoa, console,
    Deno: { env: { get: () => "mock-only" } },
    require: (name: string) => {
      if (name.includes("supabase-js")) return { createClient: () => ({}) };
      if (name === "./sms-opt-out.ts") return { checkSmsOptOut: consent, normalizeSmsPhone: () => "+14805550100" };
      throw new Error("Unexpected dependency");
    },
  });
  return { send, consent, exports };
}
describe("admin SMS copy consent boundary, simulated providers only", () => {
  it("blocks opted-out admin before Twilio", async () => {
    const mock = isolated(true);
    await mock.exports.notifyBirthdaySmsFailed("Synthetic");
    expect(mock.consent).toHaveBeenCalledExactlyOnceWith({}, "+14805550100");
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("retains consent-approved admin notifications", async () => {
    const mock = isolated(false);
    await mock.exports.notifyBirthdaySmsFailed("Synthetic");
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
  it("automatic follow-up alerts remain inert", async () => {
    const mock = isolated(false);
    await mock.exports.notifyFollowupSmsFailed("Synthetic");
    expect(mock.consent).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
  });
});