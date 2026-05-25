import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
Deno.serve((_req) => {
  const k = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY") || "";
  return new Response(JSON.stringify({ len: k.length, head: k.slice(0,20), tail: k.slice(-10), parts: k.split(".").length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
