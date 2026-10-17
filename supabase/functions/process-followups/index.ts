// Existing cron authentication is preserved. This repair is read-only until a
// separately authorized dispatch release; no request can enable sending.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { jsonResponse, requireCronSecret } from "../_shared/followup-auth.ts";
import { inspectScheduledFollowups } from "../_shared/followup-scan.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const denied = await requireCronSecret(req);
  if (denied) return denied;

  // Preserve the legacy empty body. Any non-empty body must be a JSON object;
  // sending flags are not supported and can never bypass the dry-run gate.
  const text = await req.text();
  if (text.trim()) {
    try {
      const body = JSON.parse(text);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      if (Object.keys(body).some(key => key !== "dry_run") ||
        ("dry_run" in body && body.dry_run !== true)) throw new Error();
    } catch {
      return jsonResponse({ success: false, error: "Only an empty body or {dry_run:true} is supported" }, 400);
    }
  }

  try {
    const key = Deno.env.get("LEADJIG_SERVICE_ROLE_KEY") ?? "";
    const summary = await inspectScheduledFollowups({ apiKey: key, token: key });
    console.log("process-followups: read-only scan", JSON.stringify(summary));
    return jsonResponse(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website read failed";
    console.error("process-followups: blocked read-only scan", message);
    return jsonResponse({
      success: false, dry_run: true, sending_enabled: false, sent: 0,
      scanned: 0, skipped: 0, errors: [message], error: message,
    }, 503);
  }
});
