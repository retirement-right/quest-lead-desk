import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jsonResponse, requireStaffAuth } from "../_shared/followup-auth.ts";

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "lead-documents";

const safeFileName = (name: string) => name.replace(/[^\w.\-]+/g, "_").slice(0, 180);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireStaffAuth(req);
  if (auth instanceof Response) return auth;

  const admin = createClient(CLOUD_URL, CLOUD_SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    if (req.method === "GET") {
      const leadId = new URL(req.url).searchParams.get("leadId")?.trim();
      if (!leadId) return jsonResponse({ error: "leadId is required" }, 400);

      const { data, error } = await admin
        .from("lead_documents")
        .select("*")
        .eq("lead_id", leadId)
        .order("uploaded_at", { ascending: false });

      if (error) throw error;
      return jsonResponse({ documents: data ?? [] });
    }

    if (req.method === "POST") {
      const form = await req.formData();
      const leadId = String(form.get("leadId") ?? "").trim();
      const file = form.get("file");
      if (!leadId) return jsonResponse({ error: "leadId is required" }, 400);
      if (!(file instanceof File)) return jsonResponse({ error: "file is required" }, 400);

      const fileName = file.name || "document";
      const path = `${leadId}/${Date.now()}-${safeFileName(fileName)}`;
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (upErr) throw upErr;

      const { data, error: insErr } = await admin
        .from("lead_documents")
        .insert({ lead_id: leadId, file_name: fileName, file_path: path, uploaded_by: auth.userId })
        .select("*")
        .single();

      if (insErr) {
        await admin.storage.from(BUCKET).remove([path]);
        throw insErr;
      }

      return jsonResponse({ document: data });
    }

    if (req.method === "DELETE") {
      const body = await req.json().catch(() => ({}));
      const id = String(body.id ?? "").trim();
      if (!id) return jsonResponse({ error: "id is required" }, 400);

      const { data: doc, error: fetchErr } = await admin
        .from("lead_documents")
        .select("file_path")
        .eq("id", id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;

      const { error: delErr } = await admin.from("lead_documents").delete().eq("id", id);
      if (delErr) throw delErr;
      if (doc?.file_path) await admin.storage.from(BUCKET).remove([doc.file_path]);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Document operation failed";
    console.error("lead-documents error:", message);
    return jsonResponse({ error: message }, 500);
  }
});