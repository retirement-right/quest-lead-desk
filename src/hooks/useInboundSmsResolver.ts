import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface PendingSms {
  id: string;
  from_number: string | null;
}

/** Last 10 digits, used for tolerant phone comparison. */
const phoneTail = (raw: string | null | undefined): string | null => {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * Attaches queued inbound SMS replies to their contacts.
 *
 * The Twilio webhook cannot read LeadJig (no staff session), so unknown senders
 * are queued. Here — where a staff session exists — we look the phone number up
 * in LeadJig and hand the resolved lead id to the resolve-inbound-sms function.
 */
export function useInboundSmsResolver() {
  const { user } = useAuth();
  const runningRef = useRef(false);

  useEffect(() => {
    if (!user || runningRef.current) return;
    runningRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;
        const headers = { Authorization: `Bearer ${session.access_token}` };

        const { data: listData, error: listErr } = await cloudSupabase.functions.invoke(
          "resolve-inbound-sms",
          { headers, body: { action: "list" } },
        );
        if (listErr || cancelled) return;
        const pending = ((listData as any)?.pending ?? []) as PendingSms[];
        if (pending.length === 0) return;


        const tails = new Map<string, string[]>(); // tail -> unmatched ids
        for (const row of pending) {
          const tail = phoneTail(row.from_number);
          if (!tail) continue;
          tails.set(tail, [...(tails.get(tail) ?? []), row.id]);
        }
        if (tails.size === 0) return;

        const matches: { id: string; lead_id: string }[] = [];
        for (const [tail, ids] of tails) {
          const { data: leads, error } = await supabase
            .from("leadjig_leads")
            .select("id, phone, created_at")
            .ilike("phone", `%${tail.slice(-7)}%`)
            .limit(50);
          if (error || cancelled) continue;
          const hits = (leads ?? []).filter((l: any) => phoneTail(l.phone) === tail);
          if (hits.length === 0) continue;
          hits.sort(
            (a: any, b: any) =>
              new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
          );
          const leadId = hits[0].id as string;
          for (const id of ids) matches.push({ id, lead_id: leadId });
        }
        if (matches.length === 0 || cancelled) return;

        await cloudSupabase.functions.invoke("resolve-inbound-sms", {
          headers,
          body: { action: "resolve", matches },
        });
      } catch {
        // Background best-effort; failures stay in the unmatched queue.
      } finally {
        runningRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);
}
