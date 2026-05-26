import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

const TZ = "America/Phoenix";

const fmtPhx = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: TZ,
    dateStyle: "medium",
    timeStyle: "short",
  });
};

interface FailureRow {
  id: string;
  contact_email: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  appointment_date: string | null;
  appointment_status: string;
  process_error: string;
  processed_at: string | null;
  created_at: string;
  raw_payload: Record<string, unknown> | null;
}

export default function FailedSyncs() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<FailureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setError("You are signed out — sign in to view failed syncs.");
      setLoading(false);
      return;
    }
    const { data, error: fnErr } = await cloudSupabase.functions.invoke(
      "list-failed-syncs",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (fnErr) {
      setError(fnErr.message);
    } else if (data && Array.isArray((data as { failures?: unknown }).failures)) {
      setRows((data as { failures: FailureRow[] }).failures);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (id: string) => {
    setResolvingId(id);
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      toast.error("Not signed in");
      setResolvingId(null);
      return;
    }
    const { error: fnErr } = await cloudSupabase.functions.invoke(
      "resolve-failed-sync",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { id },
      },
    );
    if (fnErr) {
      toast.error(fnErr.message);
    } else {
      toast.success("Marked as resolved");
      setRows((prev) => prev.filter((r) => r.id !== id));
    }
    setResolvingId(null);
  };

  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const visibleRows = showAll
    ? rows
    : rows.filter((r) => new Date(r.created_at).getTime() >= cutoffMs);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Failed Syncs</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${visibleRows.length} unresolved failure${visibleRows.length === 1 ? "" : "s"}${showAll ? "" : " · last 30 days"} · Arizona time`}
            {!loading && !showAll && hiddenCount > 0 && (
              <span className="ml-1">({hiddenCount} older hidden)</span>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={showAll ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAll((v) => !v)}
            disabled={loading}
          >
            {showAll ? "Show last 30 days" : "Show all history"}
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            className="bg-status-appointment text-status-appointment-foreground hover:bg-status-appointment/90"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="h-4 w-4" /> Return to CRM
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn't load failed syncs</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="h-40 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
          <div className="font-medium">
            {showAll || rows.length === 0
              ? "All BookedIN appointments are syncing cleanly."
              : "No unresolved failures in the last 30 days."}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {!showAll && hiddenCount > 0
              ? `${hiddenCount} older failure${hiddenCount === 1 ? "" : "s"} hidden — switch to "Show all history" to view.`
              : "Nothing has failed since the last resolution."}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRows.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border bg-card p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">
                      {r.contact_name || "(no contact name)"}
                    </span>
                    <Badge variant="destructive">{r.appointment_status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {r.contact_email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {r.contact_email}
                      </span>
                    )}
                    {r.contact_phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {r.contact_phone}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Appt: {fmtPhx(r.appointment_date)}
                    </span>
                    <span className="text-muted-foreground/80">
                      Received: {fmtPhx(r.created_at)}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {r.contact_email && (
                    <Link
                      to={`/?q=${encodeURIComponent(r.contact_email)}`}
                      className="text-xs underline text-muted-foreground self-center"
                    >
                      Find contact
                    </Link>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resolvingId === r.id}
                    onClick={() => resolve(r.id)}
                  >
                    {resolvingId === r.id ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                    )}
                    Mark resolved
                  </Button>
                </div>
              </div>
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs font-mono break-all text-destructive">
                {r.process_error}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
