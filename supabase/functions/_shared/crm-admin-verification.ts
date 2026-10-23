import { checkCrmAdmin, type GateResult } from "./crm-admin-gate";

// Staged read-only verification. No provider, service key, writes or dispatch.
// This adapter is not connected to any production privilege-granting handler.
export type WebsiteAuthConfig = { url: string; publishableKey: string };

export async function verifyWebsiteCrmAdmin(
  jwt: string,
  config: WebsiteAuthConfig,
  read: typeof fetch = fetch,
): Promise<GateResult> {
  if (!jwt.trim()) return { allowed: false, status: 401 };
  const headers = { apikey: config.publishableKey, Authorization: `Bearer ${jwt}` };
  let userId: string;
  try {
    const response = await read(`${config.url}/auth/v1/user`, {
      method: "GET", headers, signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) return { allowed: false, status: 401 };
    if (!response.ok) return { allowed: false, status: 503 };
    const identity: unknown = await response.json();
    if (!identity || typeof identity !== "object" || !("id" in identity) || typeof identity.id !== "string") {
      return { allowed: false, status: 503 };
    }
    userId = identity.id;
  } catch {
    return { allowed: false, status: 503 };
  }
  return checkCrmAdmin({ userId, jwt }, async (verifiedId) => {
    const query = new URLSearchParams({ select: "user_id,role", user_id: `eq.${verifiedId}`, limit: "4" });
    const response = await read(`${config.url}/rest/v1/user_roles?${query}`, {
      method: "GET", headers, signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (!response.ok) return { data: null, error: "Role read unavailable" };
    return { data: await response.json(), error: null };
  });
}