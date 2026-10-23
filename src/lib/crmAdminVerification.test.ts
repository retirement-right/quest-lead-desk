import { describe, expect, it, vi } from "vitest";
import { verifyWebsiteCrmAdmin } from "../../supabase/functions/_shared/crm-admin-verification";

const userId = "00000000-0000-4000-8000-000000000001";
const config = { url: "https://website.example.test", publishableKey: "public-test-key" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const mockReads = (role: unknown = [{ user_id: userId, role: "admin" }]) => vi.fn<typeof fetch>()
  .mockResolvedValueOnce(json({ id: userId, user_metadata: { role: "admin" } }))
  .mockResolvedValueOnce(json(role));

describe("staged CRM admin verification with simulated Website identity and self-role reads", () => {
  it("allows an identity with a matching protected admin row using GET-only reads", async () => {
    const read = mockReads();
    expect(await verifyWebsiteCrmAdmin("simulated", config, read)).toEqual({ allowed: true, userId });
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[0][0]).toBe(`${config.url}/auth/v1/user`);
    const roleUrl = new URL(String(read.mock.calls[1][0]));
    expect(roleUrl.pathname).toBe("/rest/v1/user_roles");
    expect(roleUrl.searchParams.get("user_id")).toBe(`eq.${userId}`);
    expect(roleUrl.searchParams.get("select")).toBe("user_id,role");
    for (const [, options] of read.mock.calls) {
      expect(options?.method).toBe("GET");
      expect(options?.body).toBeUndefined();
      expect(options?.headers).toEqual({ apikey: "public-test-key", Authorization: "Bearer simulated" });
    }
  });
  it("denies anonymous callers before any read", async () => {
    const read = mockReads();
    expect(await verifyWebsiteCrmAdmin("", config, read)).toEqual({ allowed: false, status: 401 });
    expect(read).not.toHaveBeenCalled();
  });
  it.each([401, 403])("rejects invalid identity (%s) before role lookup", async status => {
    const read = vi.fn<typeof fetch>().mockResolvedValue(json({}, status));
    expect(await verifyWebsiteCrmAdmin("simulated", config, read)).toEqual({ allowed: false, status: 401 });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it.each(["user", "moderator"])("denies %s even when user-editable metadata claims admin", async role => {
    expect(await verifyWebsiteCrmAdmin("simulated", config, mockReads([{ user_id: userId, role }]))).toEqual({ allowed: false, status: 403 });
  });
  it("denies a missing protected role despite metadata claiming admin", async () =>
    expect(await verifyWebsiteCrmAdmin("simulated", config, mockReads([]))).toEqual({ allowed: false, status: 403 }));
  it("rejects a substituted admin user ID", async () =>
    expect(await verifyWebsiteCrmAdmin("simulated", config, mockReads([{ user_id: "00000000-0000-4000-8000-000000000002", role: "admin" }]))).toEqual({ allowed: false, status: 503 }));
  it("rejects rows lacking identity binding", async () =>
    expect(await verifyWebsiteCrmAdmin("simulated", config, mockReads([{ role: "admin" }]))).toEqual({ allowed: false, status: 503 }));
  it("fails closed on identity-service outage", async () =>
    expect(await verifyWebsiteCrmAdmin("simulated", config, vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")))).toEqual({ allowed: false, status: 503 }));
  it("fails closed on role-service denial", async () => {
    const read = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: userId })).mockResolvedValueOnce(json({}, 403));
    expect(await verifyWebsiteCrmAdmin("simulated", config, read)).toEqual({ allowed: false, status: 503 });
  });
  it("does not trust JWT-shaped data as an authenticated identity", async () => {
    const read = vi.fn<typeof fetch>().mockResolvedValue(json({ sub: userId, role: "admin" }));
    expect(await verifyWebsiteCrmAdmin("simulated", config, read)).toEqual({ allowed: false, status: 503 });
    expect(read).toHaveBeenCalledTimes(1);
  });
});