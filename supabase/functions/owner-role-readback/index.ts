// TEMPORARY read-only check: does the fixed owner account hold the website admin role?
// Returns booleans only, takes no input, writes nothing. Delete after use.
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER = "michaeleberhardt01@gmail.com";

Deno.serve(async () => {
  const key = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY");
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  if (!key) return out({ error: "unavailable" }, 503);
  const db = createClient("https://uoneplysuvmaygbrbswd.supabase.co", key, { auth: { persistSession: false } });
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return out({ error: "user lookup failed" }, 503);
    userId = data.users.find((u) => u.email?.toLowerCase() === OWNER)?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (!userId) return out({ owner_found: false });
  const { data: roles, error } = await db.from("user_roles").select("role").eq("user_id", userId);
  if (error) return out({ owner_found: true, error: "role lookup failed" }, 503);
  const r = (roles ?? []).map((x) => x.role);
  return out({ owner_found: true, is_admin: r.includes("admin"), roles: r, id_suffix: userId.slice(-4) });
});
