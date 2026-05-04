// One-off cleanup: delete the test contact michael@asset1.com from leadjig_leads
// (lives in the Retirement-Right Supabase project).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const LEADJIG_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
const LEADJIG_KEY = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const client = createClient(LEADJIG_URL, LEADJIG_KEY);
  const { data: found, error: findErr } = await client
    .from("leadjig_leads")
    .select("id, name, email, raw_payload")
    .eq("email", "michael@asset1.com");
  if (findErr) {
    return new Response(JSON.stringify({ error: findErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const targets = (found ?? []).filter((r: any) => {
    const fn = r.raw_payload?.first_name?.trim?.() || "";
    const ln = r.raw_payload?.last_name?.trim?.() || "";
    const nm = (r.name || "").trim();
    return !fn && !ln && !nm;
  });
  const ids = targets.map((r: any) => r.id);
  let deleted: any = null;
  if (ids.length) {
    const { data, error } = await client
      .from("leadjig_leads")
      .delete()
      .in("id", ids)
      .select("id");
    if (error) {
      return new Response(JSON.stringify({ error: error.message, found, ids }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    deleted = data;
  }
  return new Response(JSON.stringify({ found, ids, deleted }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
