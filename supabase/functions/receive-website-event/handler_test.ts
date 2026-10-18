import { createReceiver } from "./handler.ts";

Deno.test("receiver rejects unauthenticated website forwarding without storage access", async () => {
  let writes = 0;
  const handler = createReceiver({ secret: () => "mock-secret", store: async () => { writes++; return "accepted"; } });
  const response = await handler(new Request("https://crm.example.test/receive-website-event", { method: "POST", body: "{}" }));
  if (response.status !== 401 || writes !== 0) throw new Error("Authentication did not fail closed");
});

Deno.test("authenticated capability check is write-free and cannot send", async () => {
  let writes = 0;
  const handler = createReceiver({ secret: () => "mock-secret", store: async () => { writes++; return "accepted"; } });
  const response = await handler(new Request("https://crm.example.test/receive-website-event", { headers: { "x-shared-secret": "mock-secret" } }));
  const body = await response.json();
  if (response.status !== 200 || body.sending_enabled !== false || body.sent !== 0 || writes !== 0) throw new Error("Capability check is not read-only");
});