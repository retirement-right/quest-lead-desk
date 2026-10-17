import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFollowupAutoSend } from "./useFollowupAutoSend";

const mock = vi.hoisted(() => ({
  allowed: vi.fn(), invoke: vi.fn(), update: vi.fn(), eq: vi.fn(),
  claim: vi.fn(), range: vi.fn(), getSession: vi.fn(), user: { id: "staff" },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mock.user }) }));
vi.mock("@/lib/marketingEmail", () => ({ canSendMarketingEmail: mock.allowed }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mock.invoke } } }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  auth: { getSession: mock.getSession },
  from: () => ({
    select: () => ({ not: () => ({ range: mock.range }) }),
    update: mock.update,
  }),
} }));

const cp = { followup_auto_send: true, followup_status: "Pending", followup_type: "email", followup_date: "2020-01-01T00:00:00Z" };
const lead = { id: "lead", name: "Mock", email: "test@example.test", phone: "4802214264", client_profile: cp };

describe("browser scheduled marketing suppression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.allowed.mockResolvedValue(true);
    mock.getSession.mockResolvedValue({ data: { session: { access_token: "mock-token" } } });
    mock.range.mockResolvedValue({ data: [lead], error: null });
    mock.invoke.mockResolvedValue({ data: { success: true }, error: null });
    mock.claim.mockResolvedValue({ data: [{ id: "lead" }], error: null });
    mock.eq.mockImplementation(() => ({ eq: mock.eq, select: mock.claim }));
    mock.update.mockImplementation(() => ({ eq: mock.eq }));
  });

  it("leaves paused emails pending without claims, sends, or activity writes", async () => {
    mock.allowed.mockResolvedValue(false);
    renderHook(() => useFollowupAutoSend());
    await waitFor(() => expect(mock.allowed).toHaveBeenCalledWith("mock-token"));
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("does not send after another tab wins the conditional claim", async () => {
    mock.claim.mockResolvedValue({ data: [], error: null });
    renderHook(() => useFollowupAutoSend());
    await waitFor(() => expect(mock.claim).toHaveBeenCalled());
    expect(mock.eq).toHaveBeenCalledWith("client_profile", cp);
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("rolls back a claim if the server reports a newly applied pause, without success activity", async () => {
    mock.invoke.mockResolvedValue({ data: { success: false, paused: true, error: "Paused" }, error: null });
    renderHook(() => useFollowupAutoSend());
    await waitFor(() => expect(mock.update).toHaveBeenCalledTimes(2));
    expect(mock.update.mock.calls[1][0]).toEqual({ client_profile: { ...cp, followup_status: "Pending", followup_sent_at: null } });
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke).toHaveBeenCalledWith("send-followup-email", expect.anything());
  });

  it("preserves successful follow-up SMS behavior without applying email pause", async () => {
    mock.range.mockResolvedValue({ data: [{ ...lead, client_profile: { ...cp, followup_type: "sms" } }], error: null });
    mock.allowed.mockResolvedValue(false);
    renderHook(() => useFollowupAutoSend());
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(2));
    expect(mock.allowed).not.toHaveBeenCalled();
    expect(mock.invoke.mock.calls[0][0]).toBe("send-followup-sms");
    expect(mock.invoke.mock.calls[1]).toEqual(["contact-activity", expect.objectContaining({ body: expect.objectContaining({ status: "sent", channel: "sms" }) })]);
  });
});