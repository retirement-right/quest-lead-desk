// Admin bulk migration: scan leadjig_leads whose notes contain
// retirement-questionnaire-style data, extract structured financial
// fields with AI, merge into client_profile.financial, and strip the
// extracted lines from notes.
// Requires staff auth to invoke.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jsonResponse, requireStaffAuth } from "../_shared/followup-auth.ts";

const LEADJIG_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
const LEADJIG_ANON_KEY =
  Deno.env.get("LEADJIG_ANON_KEY") ?? "sb_publishable_8Vv7urmF3VqUXH3avaxrsg_cfSNKWr1";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const FIN_KEYS = [
  "employment_primary","employment_spouse",
  "working_income_primary","working_income_spouse",
  "pension_income_primary","pension_income_spouse",
  "social_security_primary","social_security_spouse",
  "desired_retirement_age_primary","desired_retirement_age_spouse",
  "ira_primary","ira_spouse",
  "ira_roth_primary","ira_roth_spouse",
  "k401_primary","k401_spouse",
  "savings_primary","savings_spouse",
  "investments_primary","investments_spouse",
  "real_estate_value","mortgage_balance","mortgage_payment",
  "health_primary","health_spouse",
  "parents_primary","parents_spouse",
];

const financialProps: Record<string, unknown> = {};
for (const k of FIN_KEYS) financialProps[k] = { type: ["string","null"] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    financial: {
      type: "object",
      additionalProperties: false,
      properties: financialProps,
      required: FIN_KEYS,
    },
    cleaned_notes: {
      type: ["string","null"],
      description: "The original Main Notes with all retirement-questionnaire lines removed. Preserve unrelated notes verbatim. If nothing remains, return null.",
    },
    cleaned_additional_notes: {
      type: ["string","null"],
      description: "The original Additional Notes with all retirement-questionnaire lines removed. Preserve unrelated notes verbatim. If nothing remains, return null.",
    },
  },
  required: ["financial","cleaned_notes","cleaned_additional_notes"],
};

const SYSTEM = `You read free-form CRM notes for retirement-planning clients.
Extract structured 'financial' fields whenever a value is present (money as short strings with $; employment as 'Working' or 'Retired'; health as 'Good'/'Fair'/'Poor'; parents like 'Mother 70 D, Father 80 D' where L=living D=deceased).
Also return cleaned_notes and cleaned_additional_notes with every line you extracted removed from the matching source section, preserving unrelated commentary verbatim.
Return null for missing fields. Do not invent data.`;

// Heuristic regex to find candidates without hitting AI for every row.
const TRIGGER = /(working income|pension income|social security|401\s*\(?k\)?|ira\b|real estate value|mortgage payment|spouse health|primary health|desired retirement age|ages of (primary|spouse)'?s parents|savings or cash on hand|investments?:|net worth)/i;

async function extract(notes: string, additionalNotes: string) {
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Main Notes:\n${notes || "(empty)"}\n\nAdditional Notes:\n${additionalNotes || "(empty)"}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "notes_extract", strict: true, schema: SCHEMA },
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI ${res.status}: ${t.slice(0,200)}`);
  }
  const j = await res.json();
  const c = j?.choices?.[0]?.message?.content ?? "{}";
  return typeof c === "string" ? JSON.parse(c) : c;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const auth = await requireStaffAuth(req);
    if (auth instanceof Response) return auth;

    const staffJwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

    const body = await req.json().catch(() => ({} as any));
    const dryRun = !!body.dry_run;
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
    const onlyId: string | undefined = body.lead_id;

    const leadjig = createClient(LEADJIG_URL, LEADJIG_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${staffJwt}` } },
      auth: { persistSession: false },
    });

  let query = leadjig
    .from("leadjig_leads")
    .select("id, name, email, notes, client_profile")
    .limit(limit);
  if (onlyId) query = query.eq("id", onlyId);

  const { data: rows, error } = await query;
  if (error) return jsonResponse({ error: error.message }, 500);

  const results: any[] = [];
  let scanned = 0, matched = 0, updated = 0, failed = 0;

  for (const row of rows ?? []) {
    scanned++;
    const notes = (row.notes ?? "") as string;
    const prevCp = (row.client_profile ?? {}) as Record<string, any>;
    const additionalNotes = String(prevCp.additional_notes ?? "");
    const sourceText = [notes, additionalNotes].filter(Boolean).join("\n\n");
    if (!sourceText || !TRIGGER.test(sourceText)) continue;
    matched++;
    try {
      const out = await extract(notes, additionalNotes);
      const fin = (out.financial ?? {}) as Record<string, string | null>;
      const cleaned = (out.cleaned_notes ?? "") as string | null;
      const cleanedAdditional = (out.cleaned_additional_notes ?? "") as string | null;

      const prevFin = (prevCp.financial && typeof prevCp.financial === "object") ? prevCp.financial : {};
      const mergedFin = { ...prevFin };
      let filled = 0;
      for (const [k, v] of Object.entries(fin)) {
        if (v == null) continue;
        const s = String(v).trim();
        if (!s) continue;
        if (!mergedFin[k] || !String(mergedFin[k]).trim()) {
          mergedFin[k] = s;
          filled++;
        }
      }

      const patch = {
        notes: cleaned && cleaned.trim() ? cleaned.trim() : null,
        client_profile: {
          ...prevCp,
          additional_notes: cleanedAdditional && cleanedAdditional.trim() ? cleanedAdditional.trim() : null,
          financial: mergedFin,
        },
      };

      if (!dryRun) {
        const { error: uErr } = await leadjig
          .from("leadjig_leads")
          .update(patch)
          .eq("id", row.id);
        if (uErr) throw new Error(uErr.message);
      }
      updated++;
      results.push({ id: row.id, name: row.name, email: row.email, filled, cleaned_len: (cleaned ?? "").length, cleaned_additional_len: (cleanedAdditional ?? "").length });
    } catch (e) {
      failed++;
      results.push({ id: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

    return jsonResponse({ ok: true, dry_run: dryRun, scanned, matched, updated, failed, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Migration failed";
    console.error("admin-migrate-notes-to-financial error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
