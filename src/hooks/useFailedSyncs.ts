import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FailureSummary {
  id: string;
  contact_name: string | null;
  contact_email: string | null;
  appointment_date: string | null;
  process_error: string;
  created_at: string;
}

interface UseFailedSyncsResult {
  failures: FailureSummary[];
  count: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

const POLL_MS = 60_000;

// Polls the list-failed-syncs edge function and surfaces a toast the first
// time new failures appear in this session.
export function useFailedSyncs(enabled: boolean): UseFailedSyncsResult {
  const [failures, setFailures] = useState<FailureSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) return;
      const { data, error } = await cloudSupabase.functions.invoke(
        "list-failed-syncs",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (error) return;
      const list = (data as { failures?: FailureSummary[] })?.failures ?? [];
      setFailures(list);

      // Notify on newly-seen failures (skip the very first load).
      const newOnes = list.filter((f) => !seenIdsRef.current.has(f.id));
      if (!firstLoadRef.current && newOnes.length > 0) {
        const first = newOnes[0];
        const name = first.contact_name || first.contact_email || "Unknown contact";
        toast.error(`Sync failed: ${name}`, {
          description:
            newOnes.length === 1
              ? "Click to open Failed Syncs"
              : `${newOnes.length} new failures — click to review`,
          action: {
            label: "View",
            onClick: () => (window.location.href = "/failed-syncs"),
          },
          duration: 10_000,
        });
      }
      seenIdsRef.current = new Set(list.map((f) => f.id));
      firstLoadRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  return { failures, count: failures.length, loading, refresh };
}
