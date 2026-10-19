import { StrictMode, type ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFollowupAutoSend } from "./useFollowupAutoSend";

const mock = vi.hoisted(() => ({ allowed: vi.fn(), invoke: vi.fn(), from: vi.fn(), getSession: vi.fn(), user: { id: "staff" } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mock.user }) }));
vi.mock("@/lib/marketingEmail", () => ({ canSendMarketingEmail: mock.allowed }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mock.invoke } } }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: mock.getSession }, from: mock.from } }));

describe("automatic page-load dispatch is disabled", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([true, false, null, "unavailable"])("never reads or mutates queues or sends SMS/email with pause %s", async pause => {
    mock.allowed.mockImplementation(async () => {
      if (pause === "unavailable") throw new Error("offline");
      return pause === false;
    });
    const queue = [{ id: "overdue-sms", status: "Pending", type: "sms" }, { id: "overdue-email", status: "Pending", type: "email" }];
    const original = structuredClone(queue);
    mock.from.mockReturnValue(queue);
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const hook = renderHook(() => useFollowupAutoSend(), { wrapper });
    await act(async () => { hook.rerender(); });
    hook.unmount();
    expect(mock.from).not.toHaveBeenCalled();
    expect(mock.getSession).not.toHaveBeenCalled();
    expect(mock.allowed).not.toHaveBeenCalled();
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(queue).toEqual(original);
  });
});
