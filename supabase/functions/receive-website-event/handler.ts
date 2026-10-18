import { z } from "npm:zod@3";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const nullableText = (max: number) => z.string().max(max).nullable().optional();
const timestamp = z.string().datetime({ offset: true }).nullable().optional();
const common = {
  email: z.string().trim().toLowerCase().email().max(254),
  delivery_id: z.string().uuid(),
  event_idempotency_key: z.string().min(1).max(512),
};
const EventSchema = z.discriminatedUnion("source", [
  z.object({ ...common, source: z.literal("retirement_right_admin_checkin"),
    name: nullableText(255), lead_id: z.string().uuid().nullable().optional(),
    event_id: nullableText(255), event_name: nullableText(255),
    event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    checked_in_at: timestamp, guest_checked_in_at: timestamp, guest_name: nullableText(255),
  }).strict(),
  z.object({ ...common, source: z.literal("retirement_right_local_unsubscribe"),
    group: z.string().trim().min(1).max(255), unsubscribed_at: z.string().datetime({ offset: true }),
  }).strict(),
]);
export interface StoredEvent {
  eventKey: string; deliveryId: string; eventType: "checkin" | "unsubscribe";
  email: string; payload: Record<string, unknown>;
}
export function createReceiver(deps: {
  secret: () => string | undefined;
  store: (event: StoredEvent) => Promise<"accepted" | "duplicate" | "conflict">;
}) {
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (!["GET", "POST"].includes(req.method)) return reply({ error: "Method not allowed" }, 405);
    const expected = deps.secret();
    if (!expected) return reply({ success: false, error: "Receiver authentication unavailable" }, 503);
    const supplied = req.headers.get("x-shared-secret") || "";
    let diff = supplied.length ^ expected.length;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (supplied.charCodeAt(i) || 0);
    if (diff !== 0) return reply({ success: false, error: "Unauthorized" }, 401);
    // Authenticated capability probe: no writes, credentials, private data, or providers.
    if (req.method === "GET") return reply({ success: true, contract: "website-events-v1", sending_enabled: false, sent: 0 });
    if (!req.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "JSON required" }, 415);
    try {
      // Read at most 16 KiB, including when Content-Length is missing or inaccurate.
      const reader = req.body?.getReader();
      if (!reader) return reply({ error: "JSON required" }, 400);
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 16384) { await reader.cancel(); return reply({ error: "Event too large" }, 413); }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const parsed = EventSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
      if (!parsed.success) return reply({ error: "Invalid website event" }, 400);
      const body = parsed.data;
      if (req.headers.get("Idempotency-Key") !== body.event_idempotency_key) return reply({ error: "Idempotency key mismatch" }, 400);
      const eventType = body.source === "retirement_right_local_unsubscribe" ? "unsubscribe" : "checkin";
      if (body.source === "retirement_right_admin_checkin" && !body.checked_in_at && !body.guest_checked_in_at) return reply({ error: "Check-in timestamp required" }, 400);
      // Delivery IDs may change on retries; only the normalized event content is immutable.
      const { delivery_id, event_idempotency_key, ...payload } = body;
      let result: "accepted" | "duplicate" | "conflict";
      try {
        result = await deps.store({ eventKey: event_idempotency_key, deliveryId: delivery_id, eventType, email: body.email, payload });
      } catch { return reply({ success: false, error: "Event persistence unavailable; retry with the same key" }, 503); }
      if (result === "conflict") return reply({ success: false, error: "Idempotency key reused with different event" }, 409);
      return reply({ success: true, status: result, held: true, suppression_applied: eventType === "unsubscribe", sending_enabled: false, sent: 0 });
    } catch { return reply({ success: false, error: "Invalid JSON event" }, 400); }
  };
}