import { describe, it, expect, vi } from "vitest";
import {
  requestPasswordReset,
  parseResetLinkError,
  WEBSITE_RESET_PASSWORD_URL,
  EXPIRED_LINK_TEXT,
} from "./passwordReset";

const mockClient = () => {
  const fn = vi.fn().mockResolvedValue({ error: null });
  return { fn, client: { auth: { resetPasswordForEmail: fn } } };
};

describe("CRM password reset", () => {
  it("requests the Website's allowed reset route, never the CRM lovable.app URL", async () => {
    const { fn, client } = mockClient();
    await requestPasswordReset(client, "  Owner@Example.com ");
    expect(fn).toHaveBeenCalledWith("owner@example.com", {
      redirectTo: "https://www.retirement-right.com/admin/reset-password",
    });
    expect(WEBSITE_RESET_PASSWORD_URL).not.toContain("lovable.app");
  });

  it("does not send a request without an email", async () => {
    const { fn, client } = mockClient();
    const res = await requestPasswordReset(client, "   ");
    expect(fn).not.toHaveBeenCalled();
    expect(res.error?.message).toBe("Enter your email first");
  });

  it("shows the expired-link message for an otp_expired hash", () => {
    expect(
      parseResetLinkError("#error=access_denied&error_code=otp_expired&error_description=x"),
    ).toBe(EXPIRED_LINK_TEXT);
  });

  it("shows no error for a normal recovery hash", () => {
    expect(parseResetLinkError("#access_token=abc&type=recovery")).toBeNull();
    expect(parseResetLinkError("")).toBeNull();
  });
});
