// All group opt-outs conservatively suppress all CRM marketing email. No event
// or check-in can clear suppression; consent restoration needs separate review.
export async function emailRecipientAllowed(
  email: string,
  read: (email: string) => Promise<{ blocked: boolean; error: boolean }>,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return false;
  try {
    const result = await read(normalized);
    return result.error === false && result.blocked === false;
  } catch { return false; }
}