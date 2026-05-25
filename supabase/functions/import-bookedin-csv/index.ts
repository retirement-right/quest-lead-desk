import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PROXY_URL = "https://uoneplysuvmaygbrbswd.supabase.co/functions/v1/leadjig-update-from-bookedin";
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
      else if (c === "\r") {}
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

function parseBookingDate(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/);
  if (!m) return null;
  let h = parseInt(m[4]);
  if (m[7] === "PM" && h < 12) h += 12;
  if (m[7] === "AM" && h === 12) h = 0;
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
    const { csv, dryRun = false, onlyEmails } = await req.json();
    const onlySet: Set<string> | null = Array.isArray(onlyEmails) && onlyEmails.length
      ? new Set(onlyEmails.map((e: string) => e.toLowerCase())) : null;
    const sharedSecret = Deno.env.get("LEADJIG_SHARED_SECRET");
    if (!sharedSecret) {
      return new Response(JSON.stringify({ error: "LEADJIG_SHARED_SECRET not set" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    let sent = 0, skipped = 0, ok = 0, failed = 0;

    for (const r of rows) {
      if (!r.length || !r[iEmail]) { skipped++; continue; }
      const email = (r[iEmail] || "").trim().toLowerCase();
      const status = (r[iStatus] || "").trim();
      const client = r[iClient] || "";
      if (!email || OWN_EMAILS.has(email)) { skipped++; continue; }
      if (status !== "Booked") { skipped++; continue; }
      if (/test/i.test(client)) { skipped++; continue; }

      const apptDate = parseBookingDate(r[iDate]);
      if (!apptDate) { skipped++; continue; }
      void now;

      const phone = normalizePhone(r[iPhone] || "");
      const payload: Record<string, unknown> = {
        email,
        appointment_at: apptDate.toISOString(),
      };
      if (phone) payload.phone = phone;

      if (dryRun) {
        sent++;
        results.push({ email, payload, dryRun: true });
        continue;
      }

      try {
        const resp = await fetch(PROXY_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-shared-secret": sharedSecret,
          },
          body: JSON.stringify(payload),
        });
        const text = await resp.text();
        let body: unknown = text;
        try { body = JSON.parse(text); } catch {}
        sent++;
        if (resp.ok) { ok++; results.push({ email, status: resp.status, body }); }
        else { failed++; results.push({ email, status: resp.status, body, payload }); }
      } catch (e) {
        failed++;
        results.push({ email, error: String(e), payload });
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    return new Response(JSON.stringify({
      summary: { sent, ok, failed, skipped, total: rows.length, dryRun },
      results,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
