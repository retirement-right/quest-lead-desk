// Marks a failed BookedIN sync as resolved by clearing process_error.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jsonResponse, requireStaffAuth } from "../_shared/followup-auth.ts";

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  let body: { id?: string; note?: string };
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
  const id = String(body.id ?? "").trim();
  if (!id) return jsonResponse({ error: "id is required" }, 400);
  const note = typeof body.note === "string" ? body.note.trim() : "";

  const cloud = createClient(CLOUD_URL, CLOUD_SERVICE_ROLE);

  const resolvedTag = `resolved by ${auth.userId} at ${new Date().toISOString()}${note ? ` — ${note}` : ""}`;
  // Stash the resolution marker in notes (append) so we keep an audit trail,
  // then clear process_error so the row leaves the failed-syncs queue.
  const { data: existing, error: readErr } = await cloud
    .from("bookedin_appointments")
    .select("notes, process_error")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return jsonResponse({ error: readErr.message }, 500);
  if (!existing) return jsonResponse({ error: "not found" }, 404);

  const prevError = existing.process_error ?? "";
  const newNotes = [existing.notes, `[resolved] ${resolvedTag}${prevError ? ` — was: ${prevError}` : ""}`]
    .filter(Boolean)
    .join("\n");

  const { error: updErr } = await cloud
    .from("bookedin_appointments")
    .update({ process_error: null, notes: newNotes })
    .eq("id", id);
  if (updErr) return jsonResponse({ error: updErr.message }, 500);

  return jsonResponse({ ok: true });
});
