import { readManualDispatchBody } from "../_shared/automatic-dispatch.ts";
import { notifyFollowupSmsSent, notifyFollowupSmsFailed, notifyFollowupEmailFailed } from "../_shared/admin-notify.ts";

Deno.test("automatic dispatch remains held regardless of request enable flags", async () => {
  const result = await readManualDispatchBody(new Request("https://example.test", {
    method: "POST", body: JSON.stringify({ auto: true, sending_enabled: true, marketing_paused: false }),
  }));
  if (!(result instanceof Response)) throw new Error("Automatic request passed through");
  const body = await result.json();
  if (body.sent !== 0 || body.sending_enabled !== false || body.paused !== true) throw new Error("Unsafe dispatch response");
});

Deno.test("automatic follow-up admin alerts never call a provider", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => { called = true; throw new Error("No network permitted"); };
  try {
    await notifyFollowupSmsSent("Mock", "+14805550123");
    await notifyFollowupSmsFailed("Mock", "+14805550123");
    await notifyFollowupEmailFailed("Mock", "mock@example.test");
    if (called) throw new Error("Automatic alert attempted network");
  } finally { globalThis.fetch = original; }
});