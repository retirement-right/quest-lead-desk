// Lists BookedIN appointment rows for the Appointments page.
// Browser callers authenticate with the LeadJig CRM session; this function
// validates that session and reads the Cloud table with the service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jsonResponse, requireStaffAuth } from "../_shared/followup-auth.ts";

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  if (!CLOUD_URL || !CLOUD_SERVICE_ROLE) {
    return jsonResponse({ error: "Server not configured" }, 500);
  }

  const cloud = createClient(CLOUD_URL, CLOUD_SERVICE_ROLE);
  const appointments: unknown[] = [];
  const cancellations: unknown[] = [];
  const chunkSize = 1000;

  const fetchAll = async (statuses: string[], sink: unknown[]) => {
    let from = 0;
    while (true) {
      const { data, error } = await cloud
        .from("bookedin_appointments")
        .select("id, contact_email, contact_name, contact_phone, appointment_date, appointment_status, raw_payload, created_at")
        .in("appointment_status", statuses)
        .order("created_at", { ascending: true })
        .range(from, from + chunkSize - 1);

      if (error) return error.message;

      const batch = data ?? [];
      sink.push(...batch);
      if (batch.length < chunkSize) return null;
      from += chunkSize;
    }
  };

  const apptErr = await fetchAll(["booked", "rescheduled"], appointments);
  if (apptErr) return jsonResponse({ error: apptErr }, 500);

  const cancelErr = await fetchAll(["cancelled", "canceled"], cancellations);
  if (cancelErr) return jsonResponse({ error: cancelErr }, 500);

  return jsonResponse({ appointments, cancellations });
});

