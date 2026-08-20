import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Dispatches due auto-send follow-ups (Email / SMS) using the logged-in staff
 * session.
 *
 * The pg_cron scheduler cannot do this on its own: fetching due leads requires
 * LeadJig access, and the only working LeadJig credential is a staff session
 * (the stored service-role key is invalid, and the LeadJig-side proxy function
 * the scheduler calls is not deployed). So — exactly like the inbound-SMS
 * resolver — the work happens in the browser where a valid staff session lives.
 * Each send is marked on the lead immediately, so nothing goes out twice.
 */
export function useFollowupAutoSend() {
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

        const CHUNK = 1000;
        let from = 0;
        const all: any[] = [];
        while (!cancelled) {
          const { data, error } = await supabase
            .from("leadjig_leads")
            .select("id, name, email, phone, client_profile")
            .not("client_profile", "is", null)
            .range(from, from + CHUNK - 1);
          if (error) return;
          const batch = data ?? [];
          all.push(...batch);
          if (batch.length < CHUNK) break;
          from += CHUNK;
        }
        if (cancelled) return;

        const now = Date.now();
        const due = all.filter((l) => {
          const cp = (l.client_profile ?? {}) as Record<string, any>;
          if (!cp.followup_auto_send) return false;
          if ((cp.followup_status ?? "Pending") !== "Pending") return false;
          if (cp.followup_sent_at) return false;
          const type = String(cp.followup_type ?? "").toLowerCase();
          if (type !== "email" && type !== "sms") return false;
          if (!cp.followup_date) return false;
          const d = new Date(cp.followup_date).getTime();
          return !isNaN(d) && d <= now;
        });

        for (const lead of due) {
          if (cancelled) return;
          const cp = (lead.client_profile ?? {}) as Record<string, any>;
          const type = String(cp.followup_type).toLowerCase() as "email" | "sms";
          const recipient = String((type === "email" ? lead.email : lead.phone) ?? "").trim();
          if (!recipient) continue;

          const sentAt = new Date().toISOString();
          // Claim the follow-up before sending so a second open tab can't resend.
          const { error: claimErr } = await supabase
            .from("leadjig_leads")
            .update({
              client_profile: { ...cp, followup_status: "Sent", followup_sent_at: sentAt },
            })
            .eq("id", lead.id);
          if (claimErr) continue;

          let errMsg: string | null = null;
          try {
            const fn = type === "email" ? "send-followup-email" : "send-followup-sms";
            const { data, error } = await cloudSupabase.functions.invoke(fn, {
              headers,
              // `auto: true` tells the function to send the admin confirmation
              // (SMS success + failures) — manual sends stay silent.
              body: { leadId: lead.id, auto: true, clientName: lead.name ?? "" },
            });
            if (error) throw error;
            if (data && (data as any).success === false) {
              throw new Error((data as any).error || "Send failed");
            }
          } catch (e: any) {
            errMsg = e?.message || "Send failed";
            // Release the claim so it can be retried/reviewed.
            await supabase
              .from("leadjig_leads")
              .update({
                client_profile: { ...cp, followup_status: "Pending", followup_sent_at: null },
              })
              .eq("id", lead.id);
          }

          await cloudSupabase.functions.invoke("contact-activity", {
            headers,
            body: {
              action: "log",
              leadId: lead.id,
              type: "manual_send",
              channel: type,
              recipient,
              body: errMsg ? "" : "(scheduled auto-send follow-up)",
              status: errMsg ? "error" : "sent",
              error: errMsg,
            },
          });
        }
      } catch {
        // Best effort — anything left Pending is retried on the next load.
      } finally {
        runningRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);
}
