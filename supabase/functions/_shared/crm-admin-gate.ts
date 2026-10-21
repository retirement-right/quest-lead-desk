// STAGED, NOT WIRED INTO HANDLERS. Deny-by-default CRM access gate:
// only a validated website identity holding the protected `admin` role passes.
// Moderators, users, missing roles, lookup errors and malformed replies fail closed.
// Role is read with the caller's own website session (never a service key).

export type RoleLookup = (userId: string, jwt: string) => Promise<{ data: unknown; error: unknown }>;
export type GateResult = { allowed: true; userId: string } | { allowed: false; status: 401 | 403 | 503 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function checkCrmAdmin(
  identity: { userId: string; jwt: string } | null,
  lookupRoles: RoleLookup,
): Promise<GateResult> {
  if (!identity || !UUID.test(identity.userId) || !identity.jwt) return { allowed: false, status: 401 };
  let res: { data: unknown; error: unknown };
  try { res = await lookupRoles(identity.userId, identity.jwt); } catch { return { allowed: false, status: 503 }; }
  if (res.error) return { allowed: false, status: 503 };
  if (!Array.isArray(res.data)) return { allowed: false, status: 503 };
  for (const row of res.data) {
    if (!row || typeof row !== "object") return { allowed: false, status: 503 };
    const r = row as Record<string, unknown>;
    if (r.user_id !== undefined && r.user_id !== identity.userId) return { allowed: false, status: 503 };
  }
  const isAdmin = res.data.some((r) => (r as Record<string, unknown>).role === "admin");
  return isAdmin ? { allowed: true, userId: identity.userId } : { allowed: false, status: 403 };
}
