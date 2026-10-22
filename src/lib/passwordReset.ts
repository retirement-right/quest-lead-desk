// CRM sign-in uses the Website's auth project. Its redirect allowlist rejects the CRM
// lovable.app address (falls back to the Website home page), but accepts this route.
export const WEBSITE_RESET_PASSWORD_URL = "https://www.retirement-right.com/admin/reset-password";

export const RESET_HELP_TEXT =
  "You'll set your new password on the Retirement Right website, then come back here to sign in.";

export const EXPIRED_LINK_TEXT =
  "This reset link is invalid or has expired. Request a new one from the sign-in page and use only the newest email.";

type ResetClient = {
  auth: {
    resetPasswordForEmail: (
      email: string,
      opts: { redirectTo: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
};

export async function requestPasswordReset(client: ResetClient, email: string) {
  const target = email.trim().toLowerCase();
  if (!target) return { error: { message: "Enter your email first" } };
  return client.auth.resetPasswordForEmail(target, { redirectTo: WEBSITE_RESET_PASSWORD_URL });
}

/** Returns a friendly message when the URL hash carries an auth link error. */
export function parseResetLinkError(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!params.get("error") && !params.get("error_code")) return null;
  return EXPIRED_LINK_TEXT;
}
