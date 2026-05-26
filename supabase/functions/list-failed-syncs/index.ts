// Lists BookedIN appointments that failed to fully process or sync.
// Browser callers authenticate with the LeadJig CRM session.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jsonResponse, requireStaffAuth } from "../_shared/followup-auth.ts";

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Benign skip reasons that should NOT count as failures.
const BENIGN_SKIPS = new Set<string>([
  "cancelled event with no contact name; not forwarded",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  const cloud = createClient(CLOUD_URL, CLOUD_SERVICE_ROLE);
  const { data, error } = await cloud
    .from("bookedin_appointments")
    .select(
      "id, contact_email, contact_name, contact_phone, appointment_date, appointment_status, process_error, processed_at, created_at, raw_payload",
    )
    .not("process_error", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return jsonResponse({ error: error.message }, 500);

  const failures = (data ?? []).filter(
    (r) => r.process_error && !BENIGN_SKIPS.has(r.process_error),
  );

  return jsonResponse({ failures, count: failures.length });
});
