import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jsonResponse, requireStaffAuth } from "../_shared/followup-auth.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

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
    net_worth: { type: ["string", "null"], description: "Approximate range or dollar amount" },
    primary_concern: { type: ["string", "null"] },
    additional_notes: {
      type: ["string", "null"],
      description: "Free-form notes including financial details (income, IRA, 401k, real estate, employment, health, parents, goals, etc.) that don't fit a structured field. Multi-line allowed.",
    },
    seminar_location: { type: ["string", "null"] },
  },
  required: [
    "first_name", "last_name", "email", "phone", "address", "date_of_birth",
    "spouse_name", "spouse_birthdate", "retirement_date", "num_children",
    "net_worth", "primary_concern", "additional_notes", "seminar_location",
  ],
};

const SYSTEM = `You extract client information from financial/retirement questionnaires.
Forms may be typed OR handwritten. Read carefully.
- Dates: convert to YYYY-MM-DD. If only age is given, leave date null.
- Phone: keep digits and formatting as written; first number if multiple.
- Name: split into first_name + last_name.
- additional_notes: capture every meaningful piece of info not covered by other fields — income, savings, IRA/401k/Roth amounts, real estate, employment status, health, parents' status, retirement goals, handwritten notes, etc. Use short labeled lines.
- Return null for anything not present. Do NOT invent data.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonResponse({ error: "file is required" }, 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    // base64 encode
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const b64 = btoa(bin);
    const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
    const dataUrl = `data:${mime};base64,${b64}`;

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
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the client information from this questionnaire." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "questionnaire_fields", strict: true, schema: SCHEMA },
        },
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      if (aiRes.status === 429) return jsonResponse({ error: "AI rate limit, try again shortly" }, 429);
      if (aiRes.status === 402) return jsonResponse({ error: "AI credits exhausted — add credits in Lovable" }, 402);
      return jsonResponse({ error: `AI error ${aiRes.status}: ${text.slice(0, 400)}` }, 500);
    }

    const ai = await aiRes.json();
    const content = ai?.choices?.[0]?.message?.content ?? "{}";
    let fields: Record<string, unknown> = {};
    try {
      fields = typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      return jsonResponse({ error: "AI returned unparseable JSON", raw: content }, 500);
    }
    return jsonResponse({ fields });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Extraction failed";
    console.error("extract-questionnaire error:", msg);
    return jsonResponse({ error: msg }, 500);
  }
});
