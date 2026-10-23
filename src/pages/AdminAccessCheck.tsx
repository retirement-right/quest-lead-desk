import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { verifyWebsiteCrmAdmin } from "../../supabase/functions/_shared/crm-admin-verification";

export default function AdminAccessCheck() {
  const { loading, session } = useAuth();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function check() {
    if (!session || checking) return;
    setChecking(true);
    setResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setResult("Your session has expired. Sign in to CRM again.");
        return;
      }
      const verified = await verifyWebsiteCrmAdmin(data.session.access_token, {
        url: supabase.supabaseUrl,
        publishableKey: supabase.supabaseKey,
      });
      setResult(verified.allowed
        ? "Verified: your current Retirement Right session has the administrator role. CRM access rules have not been changed."
        : verified.status === 403
          ? "Administrator access was not confirmed for this account. CRM access rules have not been changed."
          : verified.status === 401
            ? "Your session could not be verified. Sign in to CRM again."
            : "Administrator verification is unavailable. CRM access rules have not been changed.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground px-6 py-16">
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="text-2xl font-semibold">CRM administrator access</h1>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : session ? (
          <Button onClick={check} disabled={checking}>
            {checking ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            Verify administrator access
          </Button>
        ) : <Button asChild><Link to="/login">Sign in to CRM</Link></Button>}
        {result && <p role="status" className="text-sm text-muted-foreground">{result}</p>}
        <Button asChild variant="link"><Link to="/login">Return to CRM</Link></Button>
      </div>
    </main>
  );
}