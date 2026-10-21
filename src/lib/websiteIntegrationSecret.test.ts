import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { websiteIntegrationSecret, WEBSITE_CRM_SECRET_NAME } from "../../supabase/functions/_shared/website-integration-secret";
import { createReceiver } from "../../supabase/functions/receive-website-event/handler";
import { readWebsiteFollowups } from "../../supabase/functions/_shared/website-followup-scan";

const strong = "m".repeat(40);
const env = (values: Record<string, string>) => (name: string) => values[name];

describe("dedicated website-CRM credential", () => {
  it("reads only WEBSITE_CRM_INTEGRATION_SECRET", () => {
    expect(WEBSITE_CRM_SECRET_NAME).toBe("WEBSITE_CRM_INTEGRATION_SECRET");
    expect(websiteIntegrationSecret(env({ WEBSITE_CRM_INTEGRATION_SECRET: strong }))).toBe(strong);
  });
  it("never falls back to LEADJIG_SHARED_SECRET", () => {
    expect(websiteIntegrationSecret(env({ LEADJIG_SHARED_SECRET: strong }))).toBeUndefined();
  });
  it.each(["", "short", ` ${strong}`, `${strong}\n`])("rejects missing, weak or padded value %#", value => {
    expect(websiteIntegrationSecret(env({ WEBSITE_CRM_INTEGRATION_SECRET: value }))).toBeUndefined();
  });
  it("receiver returns 503 with no writes when only the old secret exists", async () => {
    const store = vi.fn();
    const handler = createReceiver({ secret: () => websiteIntegrationSecret(env({ LEADJIG_SHARED_SECRET: strong })), store });
    const res = await handler(new Request("https://crm.test/r", { headers: { "x-shared-secret": strong } }));
    expect(res.status).toBe(503);
    expect(store).not.toHaveBeenCalled();
  });
  it("receiver rejects the old secret value once the new one is set", async () => {
    const handler = createReceiver({ secret: () => websiteIntegrationSecret(env({ WEBSITE_CRM_INTEGRATION_SECRET: strong })), store: vi.fn() });
    const res = await handler(new Request("https://crm.test/r", { headers: { "x-shared-secret": "o".repeat(40) } }));
    expect(res.status).toBe(401);
  });
  it("scanner makes no request when the new secret is missing", async () => {
    const request = vi.fn();
    await expect(readWebsiteFollowups(websiteIntegrationSecret(env({ LEADJIG_SHARED_SECRET: strong })) ?? "", request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("neither entry point references the old secret name", () => {
    for (const f of ["supabase/functions/receive-website-event/index.ts", "supabase/functions/process-followups/index.ts"])
      expect(readFileSync(f, "utf8")).not.toContain("LEADJIG_SHARED_SECRET");
  });
});
