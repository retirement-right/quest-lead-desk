import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

type Handler = (req: Request) => Promise<Response>;
type IdentityResult = { data: { user: { id: string; email: string } | null }; error: { message: string } | null };
const verifiedIdentity: IdentityResult = {
  data: { user: { id: "00000000-0000-4000-8000-000000000001", email: "identity@example.test" } }, error: null,
};

/** Executes actual auth + automatic guard + SMS source, not a live endpoint.
 * The auth service is simulated; no JWT, credentials or customer data are used.
 * All non-auth SDK operations and all fetches throw before any external effect.
 */
function isolatedSms(name: string, identity = verifiedIdentity) {
  let handler: Handler | undefined;
  const authLookup = vi.fn().mockResolvedValue(identity);
  const forbidden = vi.fn((..._args: unknown[]) => { throw new Error("External effect forbidden by isolated harness"); });
  const envGet = vi.fn((key: string) => {
    if (key === "LEADJIG_ANON_KEY") return undefined; // Public-key fallback only.
    return forbidden(key);
  });
  const sdkClient = vi.fn(() => ({ auth: { getUser: authLookup }, from: forbidden, storage: { from: forbidden } }));
  const modules: Record<string, unknown> = {
    "https://esm.sh/@supabase/supabase-js@2.95.0": { createClient: sdkClient },
    "https://esm.sh/@supabase/supabase-js@2.95.0/cors": { corsHeaders: {} },
    "npm:@supabase/supabase-js@2/cors": { corsHeaders: {} },
    "npm:zod@3.25.76": { z },
    "../_shared/admin-notify.ts": {
      notifyFollowupSmsSent: forbidden, notifyFollowupSmsFailed: forbidden,
      notifyBirthdaySmsSent: forbidden, notifyBirthdaySmsFailed: forbidden,
    },
  };
  function evaluate(path: string) {
    const exports: Record<string, unknown> = {};
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInNewContext(compiled, {
      exports, Request, Response, URLSearchParams, btoa, fetch: forbidden,
      console: { log: forbidden, error: forbidden },
      Deno: { env: { get: envGet }, serve: (callback: Handler) => { handler = callback; } },
      require: (specifier: string) => {
        if (!(specifier in modules)) throw new Error(`Unmocked dependency: ${specifier}`);
        return modules[specifier];
      },
    });
    return exports;
  }
  const auth = evaluate("supabase/functions/_shared/followup-auth.ts");
  modules["./followup-auth.ts"] = auth;
  modules["../_shared/followup-auth.ts"] = auth;
  modules["../_shared/automatic-dispatch.ts"] = evaluate("supabase/functions/_shared/automatic-dispatch.ts");
  evaluate(`supabase/functions/${name}/index.ts`);
  if (!handler) throw new Error("SMS handler did not register");
  envGet.mockClear();
  return { handler, authLookup, sdkClient, envGet, forbidden };
}

const post = (body: unknown, authorization = "Bearer simulated-identity-token") => new Request("https://isolated.example.test/sms", {
  method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe.each(["send-followup-sms", "send-birthday-sms"])("%s with actual authentication helper (identity service simulated)", name => {
  it.each([true, false, null, "unavailable"])("holds validated identity with claimed pause %s, without external effects", async pause => {
    const mock = isolatedSms(name);
    const response = await mock.handler(post({ auto: true, marketing_paused: pause }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: false, paused: true, sending_enabled: false, sent: 0 });
    expect(mock.authLookup).toHaveBeenCalledExactlyOnceWith("simulated-identity-token");
    expect(mock.sdkClient).toHaveBeenCalledTimes(1); // Only the isolated identity validation client.
    expect(mock.envGet).not.toHaveBeenCalled();
    expect(mock.forbidden).not.toHaveBeenCalled();
  });

  it("holds validated identity despite force, dry-run and sending override flags", async () => {
    const mock = isolatedSms(name);
    const response = await mock.handler(post({ auto: true, force: true, dry_run: false, sending_enabled: true, marketing_paused: false }));
    expect(await response.json()).toMatchObject({ sending_enabled: false, sent: 0 });
    expect(mock.authLookup).toHaveBeenCalledTimes(1);
    expect(mock.envGet).not.toHaveBeenCalled();
    expect(mock.forbidden).not.toHaveBeenCalled();
  });

  it.each(["", "Basic simulated", "Bearer "])("rejects missing or malformed authorization %s before identity lookup", async authorization => {
    const mock = isolatedSms(name);
    expect((await mock.handler(post({ auto: true }, authorization))).status).toBe(401);
    expect(mock.authLookup).not.toHaveBeenCalled();
    expect(mock.envGet).not.toHaveBeenCalled();
    expect(mock.forbidden).not.toHaveBeenCalled();
  });

  it.each([true, false])("rejects failed identity validation for automatic=%s without effects", async auto => {
    const mock = isolatedSms(name, { data: { user: null }, error: { message: "Invalid token" } });
    expect((await mock.handler(post({ auto }))).status).toBe(401);
    expect(mock.authLookup).toHaveBeenCalledTimes(1);
    expect(mock.envGet).not.toHaveBeenCalled();
    expect(mock.forbidden).not.toHaveBeenCalled();
  });

  it("rejects an empty identity response even without a service error", async () => {
    const mock = isolatedSms(name, { data: { user: null }, error: null });
    expect((await mock.handler(post({ auto: true }))).status).toBe(401);
    expect(mock.forbidden).not.toHaveBeenCalled();
  });

  it.each(["true", null, 1])("rejects malformed automatic flag %s after validated identity", async auto => {
    const mock = isolatedSms(name);
    expect((await mock.handler(post({ auto }))).status).toBe(400);
    expect(mock.authLookup).toHaveBeenCalledTimes(1);
    expect(mock.envGet).not.toHaveBeenCalled();
    expect(mock.forbidden).not.toHaveBeenCalled();
  });
});