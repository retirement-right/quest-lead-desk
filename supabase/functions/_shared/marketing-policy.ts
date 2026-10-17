import { websiteRead, type WebsiteAuth } from "./website-rest.ts";

export const MARKETING_BLOCKED = {
  success: false,
  paused: true,
  sent: 0,
  error: "Marketing email is paused or its global setting could not be verified.",
};

// No cache: every client marketing email must use the current authoritative row.
export async function marketingEmailAllowed(
  auth: WebsiteAuth,
  request: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const rows = await websiteRead(
      "email_marketing_settings?select=marketing_paused&id=eq.true",
      auth,
      request,
    );
    return Array.isArray(rows) && rows.length === 1 &&
      rows[0]?.marketing_paused === false;
  } catch {
    return false;
  }
}