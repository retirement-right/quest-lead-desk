import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LEADJIG_URL = "https://uoneplysuvmaygbrbswd.supabase.co";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "Adlof";
  const key = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY")!;
  const sb = createClient(LEADJIG_URL, key);

  const { data, error } = await sb
    .from("leadjig_leads")
    .select("id, name, email, phone, address, raw_payload, client_profile")
    .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(3);

  return new Response(JSON.stringify({ data, error }, null, 2), {
    headers: { "content-type": "application/json" },
  });
});
