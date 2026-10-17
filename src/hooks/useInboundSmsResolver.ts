import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { leadPhoneTails, phoneTail } from "@/lib/phoneMatching";

interface PendingSms {
  id: string;
  from_number: string | null;
}

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

        // Digits-only comparison can't be expressed in PostgREST, so page the
        // leads in and index them by every phone tail they carry (main column
        // plus raw_payload fallbacks). Newest lead wins on duplicates.
        const byTail = new Map<string, { id: string; created_at: string | null }>();
        const CHUNK = 1000;
        let from = 0;
        while (!cancelled) {
          const { data: leads, error } = await supabase
            .from("leadjig_leads")
            .select("id, phone, raw_payload, created_at")
            .range(from, from + CHUNK - 1);
          if (error) return;
          const batch = (leads ?? []) as any[];
          for (const lead of batch) {
            for (const t of leadPhoneTails(lead)) {
              if (!tails.has(t)) continue;
              const prev = byTail.get(t);
              const newer =
                !prev ||
                new Date(lead.created_at ?? 0).getTime() > new Date(prev.created_at ?? 0).getTime();
              if (newer) byTail.set(t, { id: lead.id, created_at: lead.created_at ?? null });
            }
          }
          if (batch.length < CHUNK) break;
          from += CHUNK;
        }
        if (cancelled) return;

        const matches: { id: string; lead_id: string }[] = [];
        for (const [tail, ids] of tails) {
          const hit = byTail.get(tail);
          if (!hit) continue;
          for (const id of ids) matches.push({ id, lead_id: hit.id });
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
