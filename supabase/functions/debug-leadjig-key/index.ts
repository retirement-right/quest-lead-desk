import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
Deno.serve((_req) => {
  const k = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY") || "";
  const parts = k.split(".");
  let payload: any = null;
  try { payload = JSON.parse(atob(parts[1])); } catch {}
  return new Response(JSON.stringify({ len: k.length, head: k.slice(0,12), payload }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
