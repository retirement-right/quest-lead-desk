import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const sb = createClient(
      "https://uoneplysuvmaygbrbswd.supabase.co",
      Deno.env.get("LEADJIG_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const all: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("leadjig_leads")
        .select("id,name,email,phone,date_of_birth,raw_payload,client_profile")
        .range(from, from + 999);
      if (error) throw error;
      all.push(...(data ?? []));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
    const url = new URL(req.url);
    const monthParam = url.searchParams.get("month");
    const now = new Date();
    const month = monthParam ? Number(monthParam) : now.getMonth() + 1;
    const parse = (s: any) => {
      if (!s) return null;
      const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return { y: +m[1], m: +m[2], d: +m[3] };
      const d = new Date(s);
      if (isNaN(d.getTime())) return null;
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
    };
    const rows: any[] = [];
    for (const l of all) {
      const rp = l.raw_payload || {};
      const cp = l.client_profile || {};
      const fn = [rp.first_name, rp.last_name].filter(Boolean).join(" ") || l.name || "—";
      const dob = l.date_of_birth || rp.date_of_birth || rp.birthdate || cp.birthdate;
      const p = parse(dob);
      if (p && p.m === month) rows.push({ id: l.id, who: fn, role: "primary", dob: `${p.m}/${p.d}/${p.y}`, day: p.d, email: l.email, phone: l.phone });
      const sp = parse(cp.spouse_birthdate);
      if (sp && sp.m === month) rows.push({ id: l.id, who: cp.spouse_name || "(spouse)", role: `spouse of ${fn}`, dob: `${sp.m}/${sp.d}/${sp.y}`, day: sp.d, email: l.email, phone: l.phone });
    }
    rows.sort((a, b) => a.day - b.day);
    return new Response(JSON.stringify({ total_leads: all.length, month, count: rows.length, birthdays: rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
