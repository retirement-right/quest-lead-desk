import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jsonResponse, requireStaffAuth } from "../_shared/followup-auth.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const FIN_KEYS = [
  "employment_primary", "employment_spouse",
  "working_income_primary", "working_income_spouse",
  "pension_income_primary", "pension_income_spouse",
  "social_security_primary", "social_security_spouse",
  "desired_retirement_age_primary", "desired_retirement_age_spouse",
  "ira_primary", "ira_spouse",
  "ira_roth_primary", "ira_roth_spouse",
  "k401_primary", "k401_spouse",
  "savings_primary", "savings_spouse",
  "investments_primary", "investments_spouse",
  "real_estate_value", "mortgage_balance", "mortgage_payment",
  "health_primary", "health_spouse",
  "parents_primary", "parents_spouse",
];

const financialProps: Record<string, unknown> = {};
for (const k of FIN_KEYS) financialProps[k] = { type: ["string", "null"] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    first_name: { type: ["string", "null"] },
    last_name: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    phone: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
    date_of_birth: { type: ["string", "null"], description: "YYYY-MM-DD" },
    spouse_name: { type: ["string", "null"] },
    spouse_birthdate: { type: ["string", "null"], description: "YYYY-MM-DD" },
    retirement_date: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
    num_children: { type: ["integer", "null"] },
    net_worth: { type: ["string", "null"] },
    primary_concern: { type: ["string", "null"] },
    additional_notes: {
      type: ["string", "null"],
      description: "Any leftover info that does not map to a structured field. Do NOT duplicate values already returned in `financial`.",
    },
    seminar_location: { type: ["string", "null"] },
    financial: {
      type: "object",
      additionalProperties: false,
      properties: financialProps,
      required: FIN_KEYS,
      description: "Financial & family details. Money: short string like '$48,000' or '$48,000/yr'. Employment: 'Working' or 'Retired'. Health: 'Good'/'Fair'/'Poor'. Parents: 'Mother 85 D, Father 85 D' (L=living, D=deceased). Null when not present.",
    },
  },
  required: [
    "first_name", "last_name", "email", "phone", "address", "date_of_birth",
    "spouse_name", "spouse_birthdate", "retirement_date", "num_children",
    "net_worth", "primary_concern", "additional_notes", "seminar_location",
    "financial",
  ],
};

const SYSTEM = `You extract client information from financial/retirement questionnaires (typed or handwritten) OR from free-form advisor notes.
- Dates: convert to YYYY-MM-DD. If only age is given, leave date null.
- Phone: keep digits and formatting; first number if multiple.
- Split full name into first_name + last_name.
- Populate the structured 'financial' object whenever values are present. Keep monetary values as short strings with dollar signs (e.g. "$48,000", "$3,500/mo").
- additional_notes is for leftover context only — do NOT repeat values you put into 'financial' or top-level fields.
- Return null for anything not present. Do NOT invent data.`;

async function callAI(userContent: unknown) {
  const aiRes = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "questionnaire_fields", strict: true, schema: SCHEMA },
      },
    }),
  });
  if (!aiRes.ok) {
    const text = await aiRes.text();
    if (aiRes.status === 429) return { error: "AI rate limit, try again shortly", status: 429 };
    if (aiRes.status === 402) return { error: "AI credits exhausted — add credits in Lovable", status: 402 };
    return { error: `AI error ${aiRes.status}: ${text.slice(0, 400)}`, status: 500 };
  }
  const ai = await aiRes.json();
  const content = ai?.choices?.[0]?.message?.content ?? "{}";
  try {
    return { fields: typeof content === "string" ? JSON.parse(content) : content };
  } catch {
    return { error: "AI returned unparseable JSON", status: 500 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const contentType = req.headers.get("content-type") ?? "";

    let userContent: unknown;
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return jsonResponse({ error: "file is required" }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const b64 = btoa(bin);
      const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      const dataUrl = `data:${mime};base64,${b64}`;
      userContent = [
        { type: "text", text: "Extract the client information from this questionnaire." },
        { type: "image_url", image_url: { url: dataUrl } },
      ];
    } else {
      const body = await req.json().catch(() => ({}));
      const text = String(body.text ?? "").trim();
      if (!text) return jsonResponse({ error: "text or file is required" }, 400);
      userContent = `Extract the client information from these notes:\n\n${text}`;
    }

    const result = await callAI(userContent);
    if ("error" in result) return jsonResponse({ error: result.error }, result.status ?? 500);
    return jsonResponse({ fields: result.fields });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Extraction failed";
    console.error("extract-questionnaire error:", msg);
    return jsonResponse({ error: msg }, 500);
  }
});
