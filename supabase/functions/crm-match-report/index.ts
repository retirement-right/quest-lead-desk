import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const LEADJIG_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
const LEADJIG_KEY = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const leadjig = createClient(LEADJIG_URL, LEADJIG_KEY);

    const url = new URL(req.url);
    if (url.searchParams.get("schema") === "1") {
      const { data, error } = await leadjig.from("leadjig_leads").select("*").limit(1);
      return json({ sample: data?.[0] ?? null, error: error?.message ?? null, cols: data?.[0] ? Object.keys(data[0]) : [] });
    }

    const body = await req.json();
    const queries: { filename: string; last: string; first: string }[] = body.queries ?? [];

    // Page through all leads once
    const all: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await leadjig
        .from("leadjig_leads")
        .select("id,guest_name,name,email,first_name,last_name")
        .range(from, from + PAGE - 1);
      if (error) return json({ error: error.message }, 500);
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");

    const indexed = all.map((l) => {
      const full = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || l.name || l.guest_name || "";
      return {
        id: l.id,
        full,
        first: norm(l.first_name ?? full.split(/\s+/)[0] ?? ""),
        last: norm(l.last_name ?? full.split(/\s+/).slice(-1)[0] ?? ""),
        email: l.email,
      };
    });

    const matched: any[] = [];
    const ambiguous: any[] = [];
    const unmatched: any[] = [];

    for (const q of queries) {
      const qLast = norm(q.last);
      const qFirst = norm(q.first);
      const lastHits = indexed.filter((l) => l.last === qLast);
      let firstHits = lastHits.filter((l) => l.first === qFirst);
      if (firstHits.length === 0) firstHits = lastHits.filter((l) => l.first.startsWith(qFirst) || qFirst.startsWith(l.first));
      if (firstHits.length === 1) matched.push({ filename: q.filename, lead_id: firstHits[0].id, name: firstHits[0].full, email: firstHits[0].email });
      else if (firstHits.length > 1) ambiguous.push({ filename: q.filename, candidates: firstHits.map((l) => ({ id: l.id, name: l.full, email: l.email })) });
      else if (lastHits.length > 0) ambiguous.push({ filename: q.filename, candidates: lastHits.map((l) => ({ id: l.id, name: l.full, email: l.email })), note: "last-name only" });
      else unmatched.push({ filename: q.filename, last: q.last, first: q.first });
    }

    return json({ total: queries.length, matched_count: matched.length, ambiguous_count: ambiguous.length, unmatched_count: unmatched.length, matched, ambiguous, unmatched, lead_pool_size: indexed.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
