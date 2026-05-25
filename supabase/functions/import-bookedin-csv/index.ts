import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const LEADJIG_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
const OWN_EMAILS = new Set([
  "michaeleberhardt01@gmail.com",
  "michael@retirement-right.com",
]);

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

function parseBookingDate(s: string): Date | null {
  // "2026-05-22 02:30:00 PM" - treat as America/Phoenix (MST, UTC-7, no DST)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/);
  if (!m) return null;
  let h = parseInt(m[4]);
  if (m[7] === "PM" && h < 12) h += 12;
  if (m[7] === "AM" && h === 12) h = 0;
  // Phoenix offset +07:00 -> add 7h to get UTC
  const iso = `${m[1]}-${m[2]}-${m[3]}T${String(h).padStart(2,"0")}:${m[5]}:${m[6]}-07:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function normalizePhone(p: string): string | null {
  const digits = (p || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { csv, dryRun = false } = await req.json();
    const key = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY");
    if (!key) return new Response(JSON.stringify({ error: "no key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const admin = createClient(LEADJIG_URL, key);

    const rows = parseCSV(csv);
    const header = rows.shift() || [];
    const idx = (n: string) => header.indexOf(n);
    const iDate = idx("Booking Date");
    const iEmail = idx("Email");
    const iPhone = idx("Phone");
    const iStatus = idx("Status");
    const iClient = idx("Client");

    const now = new Date();
    const results: any[] = [];
    let updatedAppt = 0, updatedPhone = 0, skipped = 0, noMatch = 0, processed = 0;

    for (const r of rows) {
      if (!r.length || !r[iEmail]) { skipped++; continue; }
      const email = r[iEmail].trim().toLowerCase();
      const status = (r[iStatus] || "").trim();
      const dateStr = r[iDate];
      const phoneRaw = r[iPhone] || "";
      const client = r[iClient] || "";

      if (!email || OWN_EMAILS.has(email)) { skipped++; continue; }
      if (status !== "Booked") { skipped++; continue; }
      if (/test/i.test(client)) { skipped++; continue; }

      const apptDate = parseBookingDate(dateStr);
      if (!apptDate) { skipped++; continue; }
      const isFuture = apptDate.getTime() > now.getTime();

      processed++;
      const { data: lead, error } = await admin
        .from("leadjig_leads")
        .select("id, email, phone, appointment_at")
        .ilike("email", email)
        .maybeSingle();

      if (error) { results.push({ email, error: error.message }); continue; }
      if (!lead) { noMatch++; results.push({ email, status: "no_match" }); continue; }

      const updates: Record<string, unknown> = {};
      if (isFuture && !lead.appointment_at) updates.appointment_at = apptDate.toISOString();
      const newPhone = normalizePhone(phoneRaw);
      if (newPhone && (!lead.phone || !String(lead.phone).trim())) updates.phone = newPhone;

      if (Object.keys(updates).length === 0) {
        results.push({ email, status: "no_changes_needed", lead_id: lead.id });
        continue;
      }

      if (!dryRun) {
        const { error: uErr } = await admin.from("leadjig_leads").update(updates).eq("id", lead.id);
        if (uErr) { results.push({ email, error: uErr.message }); continue; }
      }
      if (updates.appointment_at) updatedAppt++;
      if (updates.phone) updatedPhone++;
      results.push({ email, lead_id: lead.id, updates, dryRun });
    }

    return new Response(JSON.stringify({
      summary: { processed, updatedAppt, updatedPhone, skipped, noMatch, total: rows.length },
      results,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
