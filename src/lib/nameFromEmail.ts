// Derives a human-readable display name from an email address when a contact
// has no name fields stored (common for registration / bulk-import rows).
// e.g. "joseph.connaughton@x.com" -> "Joseph Connaughton"
const GENERIC_LOCALS = new Set([
  "info",
  "admin",
  "sales",
  "support",
  "contact",
  "hello",
  "office",
  "unknown",
  "noreply",
  "no-reply",
]);

export const nameFromEmail = (email?: string | null): string | null => {
  if (!email || typeof email !== "string" || !email.includes("@")) return null;
  const local = email.split("@")[0].trim();
  if (!local || GENERIC_LOCALS.has(local.toLowerCase())) return null;

  const parts = local
    .replace(/\d+/g, " ")
    .split(/[._\-+\s]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);

  if (!parts.length) return null;

  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
};
