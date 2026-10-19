import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { marketingEmailAllowed, MARKETING_BLOCKED } from "../../supabase/functions/_shared/marketing-policy";
import { inspectScheduledFollowups } from "../../supabase/functions/_shared/followup-scan";
import { WEBSITE_PUBLISHABLE_KEY } from "../../supabase/functions/_shared/website-rest";

type Handler = (req: Request) => Promise<Response>;

function loadHandler(name: string, policy: typeof marketingEmailAllowed) {
  let handler: Handler | undefined;
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  const notify = vi.fn();
  const insert = vi.fn().mockResolvedValue({ error: null });
  const scan = vi.fn().mockImplementation(inspectScheduledFollowups);
  const cronAuth = vi.fn().mockResolvedValue(null);
  const suppression = vi.fn().mockResolvedValue(true);
  const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const guardExports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync("supabase/functions/_shared/automatic-dispatch.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports: guardExports, Response, require: (specifier: string) => {
    if (specifier === "npm:zod@3.25.76") return { z };
    if (specifier === "./followup-auth.ts") return { jsonResponse };
    throw new Error(`Unmocked guard dependency: ${specifier}`);
  } });
  const modules: Record<string, unknown> = {
    "../_shared/automatic-dispatch.ts": guardExports,
    "npm:@supabase/supabase-js@2/cors": { corsHeaders: {} },
    "https://esm.sh/@supabase/supabase-js@2.95.0": {
      createClient: () => ({ from: () => ({ insert }), auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { email: "staff@example.test" } } }) } }),
    },
    "../_shared/followup-auth.ts": {
      jsonResponse, requireCronSecret: cronAuth,
      requireStaffAuth: vi.fn().mockResolvedValue({ userId: "mock-staff", jwt: "mock-token" }),
      loadLeadRecipient: vi.fn().mockResolvedValue({ recipient: "test@example.test", firstName: "Mock", fullName: "Mock Contact" }),
      normalizePhone: (raw: string) => raw ? "+14805550123" : null,
      normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    },
    "../_shared/admin-notify.ts": { notifyFollowupEmailFailed: notify, notifyFollowupSmsFailed: notify, notifyFollowupSmsSent: notify, notifyBirthdaySmsSent: notify, notifyBirthdaySmsFailed: notify },
    "../_shared/marketing-policy.ts": { marketingEmailAllowed: policy, MARKETING_BLOCKED },
    "../_shared/website-rest.ts": { WEBSITE_PUBLISHABLE_KEY },
    "../_shared/followup-scan.ts": { inspectScheduledFollowups: scan },
    "../_shared/cloud-email-suppression.ts": { cloudEmailRecipientAllowed: suppression },
  };
  const source = readFileSync(`supabase/functions/${name}/index.ts`, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  runInNewContext(compiled, {
    exports: {}, Request, Response, btoa, URLSearchParams, fetch: send, console: { log: vi.fn(), error: vi.fn() },
    Deno: { serve: (callback: Handler) => { handler = callback; }, env: { get: () => "mock-only-credential" } },
    require: (specifier: string) => {
      if (!(specifier in modules)) throw new Error(`Unmocked dependency: ${specifier}`);
      return modules[specifier];
    },
  });
  if (!handler) throw new Error("Handler not registered");
  return { handler, send, notify, insert, scan, cronAuth, suppression };
}

describe.each(["send-followup-email", "send-birthday-email"])("%s provider boundary", name => {
  const request = () => new Request("https://crm.example.test/function", {
    method: "POST", body: JSON.stringify({ leadId: "mock", auto: false, contactId: "mock", email: "test@example.test", personKind: "primary", firstName: "Mock" }),
  });

  it.each([true, null, "false"])("blocks setting %s with no provider, alerts, or record writes", async value => {
    const settings = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ marketing_paused: value }])));
    const mock = loadHandler(name, auth => marketingEmailAllowed(auth, settings));
    const response = await mock.handler(request());
    expect(await response.json()).toMatchObject({ success: false, paused: true, sent: 0 });
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.notify).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("fails closed if the settings service is unavailable", async () => {
    const mock = loadHandler(name, auth => marketingEmailAllowed(auth, vi.fn().mockRejectedValue(new Error("offline"))));
    expect(await (await mock.handler(request())).json()).toMatchObject({ success: false, paused: true });
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.notify).not.toHaveBeenCalled();
  });

  it("blocks a pause applied after recipient lookup", async () => {
    const policy = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const mock = loadHandler(name, policy);
    expect(await (await mock.handler(request())).json()).toMatchObject({ success: false, paused: true });
    expect(policy).toHaveBeenCalledTimes(2);
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.notify).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("allows the established email path only with explicit unpaused checks (provider mocked)", async () => {
    const settings = vi.fn().mockImplementation(async () => new Response(JSON.stringify([{ marketing_paused: false }])));
    const mock = loadHandler(name, auth => marketingEmailAllowed(auth, settings));
    expect(await (await mock.handler(request())).json()).toMatchObject({ success: true });
    expect(settings).toHaveBeenCalledTimes(2);
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect(mock.send.mock.calls[0][0]).toBe("https://api.sendgrid.com/v3/mail/send");
  });

  it("suppresses an unsubscribed recipient without providers, alerts or writes even when globally unpaused", async () => {
    const mock = loadHandler(name, vi.fn().mockResolvedValue(true));
    mock.suppression.mockResolvedValue(false);
    expect(await (await mock.handler(request())).json()).toMatchObject({ success: false, paused: true });
    expect(mock.suppression).toHaveBeenCalledWith("test@example.test");
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.notify).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  if (name === "send-birthday-email") it("suppresses delivery when the birthday BCC recipient is opted out", async () => {
    const mock = loadHandler(name, vi.fn().mockResolvedValue(true));
    mock.suppression.mockImplementation(async email => email !== "michaeleberhardt01@gmail.com");
    expect(await (await mock.handler(request())).json()).toMatchObject({ success: false, paused: true });
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });
});

describe("scheduler handler safety", () => {
  it("preserves cron authentication and rejects attempts to enable sending", async () => {
    const mock = loadHandler("process-followups", vi.fn());
    const req = new Request("https://crm.example.test/function", { method: "POST", body: '{"dry_run":false}' });
    expect((await mock.handler(req)).status).toBe(400);
    expect(mock.cronAuth).toHaveBeenCalledWith(req);
    expect(mock.scan).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("returns denied cron authentication before any scan", async () => {
    const mock = loadHandler("process-followups", vi.fn());
    mock.cronAuth.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    expect((await mock.handler(new Request("https://crm.example.test/function", { method: "POST" }))).status).toBe(401);
    expect(mock.scan).not.toHaveBeenCalled();
  });

  it("accepts the existing empty cron body and reports dry-run without sends", async () => {
    const mock = loadHandler("process-followups", vi.fn());
    mock.scan.mockResolvedValue({ success: true, dry_run: true, sending_enabled: false, sent: 0 });
    expect(await (await mock.handler(new Request("https://crm.example.test/function", { method: "POST" }))).json()).toMatchObject({ success: true, dry_run: true, sent: 0 });
    expect(mock.scan).toHaveBeenCalledTimes(1);
    expect(mock.send).not.toHaveBeenCalled();
  });

  it.each(['{"dry_run":true}', ''])("uses the configured shared secret for accepted body %s", async body => {
    const mock = loadHandler("process-followups", vi.fn());
    mock.scan.mockResolvedValue({ success: true, dry_run: true, sending_enabled: false, sent: 0 });
    expect((await mock.handler(new Request("https://crm.example.test/function", { method: "POST", body }))).status).toBe(200);
    expect(mock.scan).toHaveBeenCalledWith("mock-only-credential");
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it.each(['{"send":true}', '{"dry_run":true,"retry":true}', '[]', 'null', '"string"', 'bad JSON'])
    ("rejects unsupported body %s before reading", async body => {
      const mock = loadHandler("process-followups", vi.fn());
      expect((await mock.handler(new Request("https://crm.example.test/function", { method: "POST", body }))).status).toBe(400);
      expect(mock.scan).not.toHaveBeenCalled();
    });
  it.each(["GET", "PUT", "DELETE"])("rejects %s before cron authentication or scanning", async method => {
    const mock = loadHandler("process-followups", vi.fn());
    expect((await mock.handler(new Request("https://crm.example.test/function", { method }))).status).toBe(405);
    expect(mock.cronAuth).not.toHaveBeenCalled();
    expect(mock.scan).not.toHaveBeenCalled();
  });
  it.each(["Website scan rejected (401)", "Website scan rejected (503)", "Website scan incomplete: page budget exhausted"])
    ("reports blocked incomplete read for %s", async error => {
      const mock = loadHandler("process-followups", vi.fn());
      mock.scan.mockRejectedValue(new Error(error));
      const response = await mock.handler(new Request("https://crm.example.test/function", { method: "POST" }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ success: false, dry_run: true, sending_enabled: false,
        sent: 0, marketing_paused: true, scan_complete: false, scanned: 0 });
      expect(mock.send).not.toHaveBeenCalled();
      expect(mock.notify).not.toHaveBeenCalled();
      expect(mock.insert).not.toHaveBeenCalled();
    });
});

describe.each(["send-followup-sms", "send-birthday-sms", "send-followup-email", "send-birthday-email"])("%s automatic hold", name => {
  it.each([true, false, null, "unavailable"])("blocks automatic requests with pause %s before providers, alerts, settings or writes", async pause => {
    const policy = vi.fn().mockImplementation(async () => {
      if (pause === "unavailable") throw new Error("offline");
      return pause === false;
    });
    const mock = loadHandler(name, policy);
    const response = await mock.handler(new Request("https://crm.example.test/function", {
      method: "POST", body: JSON.stringify({ auto: true, leadId: "mock", contactId: "mock", phone: "+14805550123" }),
    }));
    expect(await response.json()).toMatchObject({ success: false, paused: true, sending_enabled: false, sent: 0 });
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.notify).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
    expect(policy).not.toHaveBeenCalled();
  });
  it.each(['{"auto":"false"}', '{"auto":null}', '{"auto":1}', 'null', '[]', 'bad JSON'])("rejects malformed dispatch %s without side effects", async body => {
    const mock = loadHandler(name, vi.fn());
    expect((await mock.handler(new Request("https://crm.example.test/function", { method: "POST", body }))).status).toBe(400);
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.notify).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });
});

describe("manual SMS compatibility (all providers mocked)", () => {
  it.each(["send-followup-sms", "send-birthday-sms"])("retains explicit manual %s", async name => {
    const mock = loadHandler(name, vi.fn());
    mock.send.mockImplementation(async () => new Response(JSON.stringify({ sid: "mock-only-sid" }), { status: 202 }));
    expect(await (await mock.handler(new Request("https://crm.example.test/function", {
      method: "POST", body: JSON.stringify({ auto: false, leadId: "mock", contactId: "mock", phone: "+14805550123", firstName: "Mock", contactName: "Mock" }),
    }))).json()).toMatchObject({ success: true });
    expect(mock.send.mock.calls[0][0]).toContain("api.twilio.com");
  });
});
