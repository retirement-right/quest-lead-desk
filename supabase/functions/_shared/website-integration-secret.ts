// Dedicated website<->CRM credential. Deliberately has no fallback to
// LEADJIG_SHARED_SECRET (used by BookedIN/LeadJig forwarding): the website
// integration never authenticated successfully, so nothing depends on it,
// and sharing one value would widen the blast radius of either leak.
export const WEBSITE_CRM_SECRET_NAME = "WEBSITE_CRM_INTEGRATION_SECRET";
export const MIN_SECRET_LENGTH = 32;

/** Returns the secret only when present and strong enough; otherwise undefined (fail closed). */
export function websiteIntegrationSecret(read: (name: string) => string | undefined): string | undefined {
  const value = read(WEBSITE_CRM_SECRET_NAME);
  if (typeof value !== "string" || value.trim() !== value || value.length < MIN_SECRET_LENGTH) return undefined;
  return value;
}
