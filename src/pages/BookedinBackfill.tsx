import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, Lead } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type CsvRow = { email: string; client: string; phone: string };

type Plan = {
  lead: Lead;
  csvClient: string;
  setFirst?: string;
  setLast?: string;
  setPhone?: string;
};

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

function normalizePhone(p: string): string | null {
  const digits = (p || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

// "Kathleen & Adolfo Esquibel" -> { first: "Kathleen", last: "Esquibel" }
function splitClientName(client: string): { first: string; last: string } | null {
  let s = (client || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  // Reject obvious non-person entries (internal blocks, exams, tests)
  if (/(exam|test|block|lunch|call\b.*\d|series\s*65)/i.test(s) && !/@/.test(s)) {
    // still allow if it looks like "First Last" only
    if (s.split(" ").length > 3) return null;
  }
  if (s.includes(",")) {
    const [lastPart, rest] = s.split(",");
    const first = (rest || "").split(/&|\band\b/i)[0].trim().split(" ")[0] || "";
    return { first, last: lastPart.trim() };
  }
  const tokens = s.split(" ");
  const last = tokens[tokens.length - 1];
  const beforeLast = tokens.slice(0, -1);
  const firstSegment = beforeLast.join(" ").split(/&|\band\b/i)[0].trim();
  const first = firstSegment.split(" ")[0] || "";
  if (!first) return { first: last, last: "" };
  return { first, last };
}

const hasName = (l: Lead) =>
  Boolean((l.first_name || "").trim() || (l.last_name || "").trim() || (l.name || "").trim());

export default function BookedinBackfill() {
  const [csvRows, setCsvRows] = useState<CsvRow[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [noCsvMatch, setNoCsvMatch] = useState<Lead[]>([]);
  const [done, setDone] = useState<{ ok: number; failed: number } | null>(null);

  async function handleFile(file: File) {
    setPlans(null);
    setDone(null);
    const text = await file.text();
    const rows = parseCSV(text);
    const header = rows.shift() || [];
    const iEmail = header.indexOf("Email");
    const iClient = header.indexOf("Client");
    const iPhone = header.indexOf("Phone");
    if (iEmail === -1 || iClient === -1) {
      toast.error("CSV must contain 'Client' and 'Email' columns");
      return;
    }
    const out: CsvRow[] = [];
    for (const r of rows) {
      const email = (r[iEmail] || "").trim().toLowerCase();
      if (!email) continue;
      out.push({ email, client: (r[iClient] || "").trim(), phone: (r[iPhone] || "").trim() });
    }
    setCsvRows(out);
    toast.success(`Loaded ${out.length} BookedIN rows with emails`);
  }

  async function buildReport() {
    if (!csvRows) return;
    setScanning(true);
    setDone(null);
    try {
      // Best info per email (prefer a row that has both a name and a phone)
      const byEmail = new Map<string, CsvRow>();
      for (const r of csvRows) {
        const prev = byEmail.get(r.email);
        const score = (r.client ? 2 : 0) + (r.phone ? 1 : 0);
        const prevScore = prev ? (prev.client ? 2 : 0) + (prev.phone ? 1 : 0) : -1;
        if (score > prevScore) byEmail.set(r.email, r);
      }

      const { data, error } = await supabase
        .from("leadjig_leads")
        .select("id, email, first_name, last_name, name, phone, raw_payload")
        .limit(20000);
      if (error) throw error;

      const leads = (data || []) as Lead[];
      const incomplete = leads.filter((l) => !hasName(l) || !(l.phone || "").trim());

      const nextPlans: Plan[] = [];
      const unmatched: Lead[] = [];

      for (const lead of incomplete) {
        const email = (lead.email || "").trim().toLowerCase();
        const row = email ? byEmail.get(email) : undefined;
        if (!row) { unmatched.push(lead); continue; }

        const plan: Plan = { lead, csvClient: row.client };
        if (!hasName(lead)) {
          const parsed = splitClientName(row.client);
          if (parsed && (parsed.first || parsed.last)) {
            plan.setFirst = parsed.first || undefined;
            plan.setLast = parsed.last || undefined;
          }
        }
        if (!(lead.phone || "").trim()) {
          const phone = normalizePhone(row.phone);
          if (phone) plan.setPhone = phone;
        }
        if (plan.setFirst || plan.setLast || plan.setPhone) nextPlans.push(plan);
      }

      setPlans(nextPlans);
      setNoCsvMatch(unmatched);
    } catch (e: any) {
      toast.error(e?.message || "Failed to build report");
    } finally {
      setScanning(false);
    }
  }

  async function applyAll() {
    if (!plans?.length) return;
    setApplying(true);
    let ok = 0, failed = 0;
    for (const p of plans) {
      const payload: Record<string, unknown> = {};
      if (p.setFirst) payload.first_name = p.setFirst;
      if (p.setLast) payload.last_name = p.setLast;
      if (p.setPhone) payload.phone = p.setPhone;
      const { error } = await supabase.from("leadjig_leads").update(payload).eq("id", p.lead.id);
      if (error) failed++; else ok++;
    }
    setApplying(false);
    setDone({ ok, failed });
    if (failed) toast.error(`${ok} updated, ${failed} failed`);
    else toast.success(`${ok} contacts updated`);
  }

  const stats = useMemo(() => {
    if (!plans) return null;
    return {
      total: plans.length,
      names: plans.filter((p) => p.setFirst || p.setLast).length,
      phones: plans.filter((p) => p.setPhone).length,
    };
  }, [plans]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">BookedIN Contact Backfill</h1>
        <p className="text-sm text-muted-foreground">
          Match a BookedIN report by email to fill in missing contact names and phone numbers.
          Existing values are never overwritten.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Upload BookedIN report (CSV)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <Button onClick={buildReport} disabled={!csvRows || scanning}>
            {scanning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Build match report
          </Button>
        </CardContent>
      </Card>

      {plans && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              2. Review — {stats?.total} contacts can be completed ({stats?.names} names, {stats?.phones} phones)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[420px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>BookedIN client</TableHead>
                    <TableHead>New name</TableHead>
                    <TableHead>New phone</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((p) => (
                    <TableRow key={p.lead.id}>
                      <TableCell className="text-xs">
                        <Link className="underline" to={`/contacts/${p.lead.id}`}>{p.lead.email || "—"}</Link>
                      </TableCell>
                      <TableCell className="text-xs">{p.csvClient || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {[p.setFirst, p.setLast].filter(Boolean).join(" ") || "—"}
                      </TableCell>
                      <TableCell className="text-xs">{p.setPhone || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground">
              {noCsvMatch.length} incomplete contacts had no matching email in this report and will be left alone.
            </p>

            <Button onClick={applyAll} disabled={applying || !plans.length}>
              {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm and update {plans.length} contacts
            </Button>

            {done && (
              <p className="text-sm">
                Updated {done.ok} contacts{done.failed ? `, ${done.failed} failed` : ""}.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
