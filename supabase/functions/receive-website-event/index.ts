import { createClient } from "npm:@supabase/supabase-js@2";
import { createReceiver } from "./handler.ts";
import { websiteIntegrationSecret } from "../_shared/website-integration-secret.ts";

Deno.serve(createReceiver({
  secret: () => websiteIntegrationSecret(name => Deno.env.get(name)),
  store: async (event) => {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Storage unavailable");
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await db.rpc("accept_website_event", {
      _event_key: event.eventKey, _delivery_id: event.deliveryId, _event_type: event.eventType,
      _email: event.email, _payload: event.payload,
    });
    if (error || !["accepted", "duplicate", "conflict"].includes(data)) throw new Error("Persistence failed");
    return data;
  },
}));