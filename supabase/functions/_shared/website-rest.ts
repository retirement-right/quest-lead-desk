// The website owns CRM lead data and the global marketing-email setting.
export const WEBSITE_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
export const WEBSITE_PUBLISHABLE_KEY = "sb_publishable_8Vv7urmF3VqUXH3avaxrsg_cfSNKWr1";

export interface WebsiteAuth {
  apiKey: string;
  token: string;
}

export async function websiteRead(
  path: string,
  auth: WebsiteAuth,
  request: typeof fetch = fetch,
): Promise<unknown> {
  if (!auth.apiKey || !auth.token) throw new Error("Website read credential unavailable");
  const response = await request(`${WEBSITE_URL}/rest/v1/${path}`, {
    method: "GET",
    headers: { apikey: auth.apiKey, Authorization: `Bearer ${auth.token}` },
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  // Never include upstream response bodies: they can contain private data.
  if (!response.ok) throw new Error(`Website read rejected (${response.status})`);
  return response.json();
}