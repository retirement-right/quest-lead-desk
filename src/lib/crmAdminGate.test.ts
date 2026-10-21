import { describe, expect, it, vi } from "vitest";
import { checkCrmAdmin } from "../../supabase/functions/_shared/crm-admin-gate";

const id = { userId: "00000000-0000-4000-8000-000000000001", jwt: "simulated" };
const rows = (...roles: string[]) => vi.fn().mockResolvedValue({ data: roles.map((role) => ({ user_id: id.userId, role })), error: null });

describe("CRM admin-only gate (owner rule: only the verified admin account)", () => {
  it("allows admin", async () => expect(await checkCrmAdmin(id, rows("admin"))).toEqual({ allowed: true, userId: id.userId }));
  it("denies moderator", async () => expect(await checkCrmAdmin(id, rows("moderator"))).toEqual({ allowed: false, status: 403 }));
  it("denies ordinary user", async () => expect(await checkCrmAdmin(id, rows("user"))).toEqual({ allowed: false, status: 403 }));
  it("denies account with no role", async () => expect(await checkCrmAdmin(id, rows())).toEqual({ allowed: false, status: 403 }));
  it("rejects missing identity without lookup", async () => {
    const l = rows("admin");
    expect(await checkCrmAdmin(null, l)).toEqual({ allowed: false, status: 401 });
    expect(l).not.toHaveBeenCalled();
  });
  it("rejects non-UUID identity", async () => expect((await checkCrmAdmin({ userId: "x", jwt: "j" }, rows("admin"))).allowed).toBe(false));
  it("fails closed on lookup error", async () =>
    expect(await checkCrmAdmin(id, vi.fn().mockResolvedValue({ data: null, error: { message: "x" } }))).toEqual({ allowed: false, status: 503 }));
  it("fails closed on thrown lookup", async () =>
    expect(await checkCrmAdmin(id, vi.fn().mockRejectedValue(new Error("net")))).toEqual({ allowed: false, status: 503 }));
  it("fails closed on malformed reply", async () =>
    expect(await checkCrmAdmin(id, vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }))).toEqual({ allowed: false, status: 503 }));
  it("fails closed on another user's admin row", async () =>
    expect(await checkCrmAdmin(id, vi.fn().mockResolvedValue({ data: [{ user_id: "00000000-0000-4000-8000-000000000002", role: "admin" }], error: null }))).toEqual({ allowed: false, status: 503 }));
});
