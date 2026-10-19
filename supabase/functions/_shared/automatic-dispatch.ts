import { z } from "npm:zod@3.25.76";
import { jsonResponse } from "./followup-auth.ts";

export const AUTOMATIC_DISPATCH_HELD = {
  success: false,
  paused: true,
  sending_enabled: false,
  sent: 0,
  error: "Automatic messaging is disabled pending independent owner authorization.",
};

const DispatchBody = z.object({ auto: z.boolean().optional() }).passthrough();

// No request flag, pause read, environment setting or staff session can enable
// automatic dispatch. Manual requests retain their established behavior.
export async function readManualDispatchBody(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    const parsed = DispatchBody.safeParse(await req.json());
    if (!parsed.success) return jsonResponse({ error: "Invalid dispatch body; auto must be a boolean." }, 400);
    if (parsed.data.auto === true) return jsonResponse(AUTOMATIC_DISPATCH_HELD);
    return parsed.data;
  } catch {
    return jsonResponse({ error: "Invalid JSON dispatch body." }, 400);
  }
}