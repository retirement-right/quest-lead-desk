import { createClient } from "npm:@supabase/supabase-js@2";
import { emailRecipientAllowed } from "./email-suppression.ts";

export async function cloudEmailRecipientAllowed(email: string): Promise<boolean> {
  return emailRecipientAllowed(email, async normalized => {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return { blocked: true, error: true };
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await db.from("crm_email_suppressions").select("email").eq("email", normalized).maybeSingle();
    return { blocked: data !== null, error: !!error };
  });
}