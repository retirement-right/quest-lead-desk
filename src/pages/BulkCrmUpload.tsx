import { useMemo, useState } from "react";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type ExtractedFields = {
  primaryName?: string | null;
  spouseName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  cityStateZip?: string | null;
  dob?: string | null;
  spouseDob?: string | null;
  retirementDate?: string | null;
  netWorth?: string | null;
  primaryConcern?: string | null;
  additionalNotes?: string | null;
  numChildren?: string | null;
  occupation?: string | null;
  employer?: string | null;
  seminarLocation?: string | null;
  allKv?: Record<string, string>;
};

type ParsedFile = { filename: string; last: string; first: string; blob: Blob; fields: ExtractedFields };
type Matched = { filename: string; lead_id: string; name: string; email?: string | null; blob: Blob; fields: ExtractedFields };
type Ambiguous = { filename: string; candidates: { id: string; name: string; email?: string | null }[]; note?: string };
type Unmatched = { filename: string; last: string; first: string; blob: Blob; fields: ExtractedFields };

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");

function parseFilename(name: string): { last: string; first: string } {
  let base = name.replace(/\.xlsx$/i, "").replace(/_CRM$/i, "");
  base = base.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const commaIdx = base.indexOf(",");
  if (commaIdx === -1) {
    const parts = base.split(/\s+/);
    return { last: parts[parts.length - 1] ?? "", first: parts[0] ?? "" };
  }
  const last = base.slice(0, commaIdx).trim();
  const rest = base.slice(commaIdx + 1).trim();
  const firstPart = rest.split(/&|\band\b/i)[0].trim();
  const firstToken = firstPart.split(/\s+/)[0] ?? "";
  return { last, first: firstToken };
}

function splitName(full: string | null | undefined): { first: string; last: string } {
  const s = (full || "").trim();
  if (!s) return { first: "", last: "" };
  if (s.includes(",")) {
    const [lp, rp] = s.split(",");
    return { last: (lp || "").trim(), first: (rp || "").trim().split(/\s+/)[0] ?? "" };
  }
  const parts = s.split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.length > 1 ? parts[parts.length - 1] : "" };
}

function normLabel(v: any): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function extractFieldsFromXlsx(blob: Blob, fallback: { first: string; last: string }): Promise<ExtractedFields> {
  try {
    const buf = await blob.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });

    const kv = new Map<string, string>();
    for (const r of rows) {
      if (!r) continue;
      // 4-col layout: [label, val, label, val]
      for (let i = 0; i < r.length; i += 2) {
        const label = normLabel(r[i]);
        const val = r[i + 1];
        if (label && val != null && String(val).trim() !== "" && String(val).trim() !== "—") {
          if (!kv.has(label)) kv.set(label, String(val).trim());
        }
      }
    }

    const get = (...keys: string[]) => {
      for (const k of keys) {
        const v = kv.get(k);
        if (v) return v;
      }
      return null;
    };

    const primaryName = get("primaryname", "name", "clientname");
    const spouseName = get("spousename", "spouse");
    const { first, last } = splitName(primaryName);
    const allKv: Record<string, string> = {};
    kv.forEach((v, k) => { allKv[k] = v; });

    return {
      primaryName,
      spouseName,
      firstName: first || fallback.first || null,
      lastName: last || fallback.last || null,
      email: get("email", "primaryemail", "emailaddress"),
      phone: get("phone", "primaryphone", "cellphone", "mobile"),
      address: get("address", "streetaddress"),
      cityStateZip: get("citystatezip", "citystate", "city"),
      dob: get("primarydob", "dob", "dateofbirth", "birthdate"),
      spouseDob: get("spousedob", "spousedateofbirth", "spousebirthdate", "spousebirthday"),
      retirementDate: get("retirementdate", "targetretirementdate", "retirement", "retireby"),
      netWorth: get("networth", "totalnetworth", "estimatednetworth", "assets", "totalassets"),
      primaryConcern: get("primaryconcern", "topconcern", "topconcerns", "concern", "concerns", "biggestconcern"),
      additionalNotes: get("additionalnotes", "notes", "comments", "additionalcomments", "advisornotes"),
      numChildren: get("numchildren", "numberofchildren", "children", "kids", "ofchildren"),
      occupation: get("occupation", "primaryoccupation", "job", "jobtitle", "title"),
      employer: get("employer", "primaryemployer", "company"),
      seminarLocation: get("seminarlocation", "eventlocation", "location", "venue"),
      allKv,
    };
  } catch (e) {
    console.warn("xlsx parse failed", e);
    return { firstName: fallback.first || null, lastName: fallback.last || null };
  }
}

function toIsoDate(s?: string | null): string | null {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  // YYYY-MM-DD already
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  // M/D/YYYY or M-D-YYYY
  const us = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (us) {
    let [, mo, d, y] = us;
    if (y.length === 2) y = (Number(y) > 30 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const t = Date.parse(str);
  if (!isNaN(t)) {
    const dt = new Date(t);
    const y = dt.getUTCFullYear();
    const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function toNumber(s?: string | null): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

const isBlank = (v: any) =>
  v == null || v === "" || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

function buildClientProfilePatch(f: ExtractedFields, existing: Record<string, any>) {
  const patch: Record<string, any> = { ...existing };
  let changed = false;
  const set = (k: string, v: any) => {
    if (v == null || v === "") return;
    if (isBlank(existing[k])) { patch[k] = v; changed = true; }
  };
  set("spouse_name", f.spouseName ?? null);
  set("spouse_birthdate", toIsoDate(f.spouseDob));
  set("retirement_date", toIsoDate(f.retirementDate));
  set("net_worth", f.netWorth ?? null);
  set("primary_concern", f.primaryConcern ?? null);
  set("additional_notes", f.additionalNotes ?? null);
  set("num_children", toNumber(f.numChildren));
  set("occupation", f.occupation ?? null);
  set("employer", f.employer ?? null);
  set("seminar_location", f.seminarLocation ?? null);
  return { patch, changed };
}

function buildLeadPatch(f: ExtractedFields, lead: Record<string, any>) {
  const patch: Record<string, any> = {};
  if (isBlank(lead.email) && f.email) patch.email = f.email;
  if (isBlank(lead.phone) && f.phone) patch.phone = f.phone;
  if (isBlank(lead.address)) {
    const addr = [f.address, f.cityStateZip].filter(Boolean).join(", ");
    if (addr) patch.address = addr;
  }
  if (isBlank(lead.date_of_birth) && f.dob) {
    const d = toIsoDate(f.dob);
    if (d) patch.date_of_birth = d;
  }
  const rp = (lead.raw_payload ?? {}) as Record<string, any>;
  const mergedRaw = { ...rp };
  let rpChanged = false;
  if (isBlank(rp.first_name) && f.firstName) { mergedRaw.first_name = f.firstName; rpChanged = true; }
  if (isBlank(rp.last_name) && f.lastName) { mergedRaw.last_name = f.lastName; rpChanged = true; }
  if (isBlank(rp.crm_extracted) && f.allKv && Object.keys(f.allKv).length) {
    mergedRaw.crm_extracted = f.allKv; rpChanged = true;
  }
  if (rpChanged) patch.raw_payload = mergedRaw;
  const cp = (lead.client_profile ?? {}) as Record<string, any>;
  const { patch: cpPatch, changed: cpChanged } = buildClientProfilePatch(f, cp);
  if (cpChanged) patch.client_profile = cpPatch;
  return patch;
}

export default function BulkCrmUpload() {
  const [matched, setMatched] = useState<Matched[]>([]);
  const [ambiguous, setAmbiguous] = useState<Ambiguous[]>([]);
  const [unmatched, setUnmatched] = useState<Unmatched[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [createMissing, setCreateMissing] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number; failures: { filename: string; error: string }[]; created: number }>({
    done: 0,
    total: 0,
    failures: [],
    created: 0,
  });
  const [reportReady, setReportReady] = useState(false);
  const [poolSize, setPoolSize] = useState<number | null>(null);

  const onZipSelected = async (file: File) => {
    setLoading(true);
    setReportReady(false);
    setMatched([]);
    setAmbiguous([]);
    setUnmatched([]);
    setPoolSize(null);
    try {
      const zip = await JSZip.loadAsync(file);
      const files: ParsedFile[] = [];
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        if (path.startsWith("__MACOSX/")) continue;
        const fname = path.split("/").pop() || "";
        if (!/_CRM\.xlsx$/i.test(fname)) continue;
        const blob = await entry.async("blob");
        const { last, first } = parseFilename(fname);
        const fields = await extractFieldsFromXlsx(blob, { first, last });
        files.push({ filename: fname, last, first, blob, fields });
      }
      toast.success(`Extracted ${files.length} CRM files`);

      toast.info("Loading contacts…");
      const allLeads: { id: string; full: string; first: string; last: string; email?: string | null }[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("leadjig_leads")
          .select("id, name, guest_name, email")
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`Contacts query failed: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const l of data as any[]) {
          const full: string = (l.name || l.guest_name || "").trim();
          const { first, last } = splitName(full);
          allLeads.push({ id: l.id, full, first: norm(first), last: norm(last), email: l.email });
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      toast.success(`Loaded ${allLeads.length} contacts`);
      setPoolSize(allLeads.length);

      const m: Matched[] = [];
      const a: Ambiguous[] = [];
      const u: Unmatched[] = [];
      for (const p of files) {
        const qL = norm(p.last);
        const qF = norm(p.first);
        const lastHits = allLeads.filter((l) => l.last === qL);
        let firstHits = lastHits.filter((l) => l.first === qF);
        if (firstHits.length === 0 && qF) {
          firstHits = lastHits.filter((l) => l.first && (l.first.startsWith(qF) || qF.startsWith(l.first)));
        }
        if (firstHits.length === 1) {
          m.push({ filename: p.filename, lead_id: firstHits[0].id, name: firstHits[0].full, email: firstHits[0].email, blob: p.blob, fields: p.fields });
        } else if (firstHits.length > 1) {
          a.push({ filename: p.filename, candidates: firstHits.map((l) => ({ id: l.id, name: l.full, email: l.email })) });
        } else if (lastHits.length === 1) {
          m.push({ filename: p.filename, lead_id: lastHits[0].id, name: lastHits[0].full, email: lastHits[0].email, blob: p.blob, fields: p.fields });
        } else if (lastHits.length > 1) {
          a.push({ filename: p.filename, candidates: lastHits.map((l) => ({ id: l.id, name: l.full, email: l.email })), note: "last-name only" });
        } else {
          u.push({ filename: p.filename, last: p.last, first: p.first, blob: p.blob, fields: p.fields });
        }
      }
      setMatched(m);
      setAmbiguous(a);
      setUnmatched(u);
      setReportReady(true);
      toast.success(`Matched ${m.length} of ${files.length}`);
    } catch (e: any) {
      console.error("Bulk CRM upload error:", e);
      toast.error(e?.message || "Failed to parse zip / match contacts");
      setReportReady(true);
    } finally {
      setLoading(false);
    }
  };

  const uploadToLead = async (
    leadId: string,
    filename: string,
    blob: Blob,
    userId: string | null,
    idx: number
  ) => {
    const form = new FormData();
    form.append("leadId", leadId);
    form.append("file", blob, filename);
    const { data, error } = await cloudSupabase.functions.invoke("lead-documents", {
      body: form,
      headers: { Authorization: `Bearer ${userId}` },
    });
    if (error || (data as any)?.error) throw new Error(error?.message || (data as any).error);
  };

  const confirmUpload = async () => {
    const willCreate = createMissing ? unmatched.length : 0;
    const total = matched.length + willCreate;
    if (!total) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      toast.error("You're not signed in to the CRM. Please log in and try again.");
      return;
    }
    const msg = willCreate
      ? `Upload ${matched.length} files to existing contacts AND create ${willCreate} new contacts from unmatched files?`
      : `Upload ${matched.length} files to their matched contacts?`;
    if (!confirm(msg)) return;
    setUploading(true);
    const token = session.access_token;
    const failures: { filename: string; error: string }[] = [];
    let created = 0;
    let enriched = 0;
    setProgress({ done: 0, total, failures: [], created: 0 });

    let i = 0;
    for (const m of matched) {
      try {
        await uploadToLead(m.lead_id, m.filename, m.blob, token, i);
        // Enrich existing contact with any new info from the Excel (only fills empty fields)
        try {
          const { data: existing } = await supabase
            .from("leadjig_leads")
            .select("email, phone, address, date_of_birth, raw_payload, client_profile")
            .eq("id", m.lead_id)
            .maybeSingle();
          if (existing) {
            const patch = buildLeadPatch(m.fields, existing as any);
            if (Object.keys(patch).length > 0) {
              const { error: upErr } = await supabase
                .from("leadjig_leads")
                .update(patch)
                .eq("id", m.lead_id);
              if (!upErr) enriched++;
            }
          }
        } catch (e) {
          console.warn("enrich failed", m.filename, e);
        }
      } catch (e: any) {
        failures.push({ filename: m.filename, error: e?.message || String(e) });
      }
      i++;
      setProgress({ done: i, total, failures: [...failures], created });
    }

    if (createMissing) {
      for (const u of unmatched) {
        try {
          const f = u.fields;
          const combinedName =
            f.primaryName ||
            [f.firstName, f.lastName].filter(Boolean).join(" ") ||
            [u.first, u.last].filter(Boolean).join(" ") ||
            null;
          const { patch: cpPatch } = buildClientProfilePatch(f, {});
          const payload: Record<string, any> = {
            name: combinedName,
            raw_payload: {
              first_name: f.firstName || u.first || null,
              last_name: f.lastName || u.last || null,
              spouse_name: f.spouseName || null,
              date_of_birth: f.dob || null,
              city_state_zip: f.cityStateZip || null,
              source: "bulk-crm-upload",
              crm_extracted: f.allKv || null,
            },
            email: f.email || null,
            phone: f.phone || null,
            address: [f.address, f.cityStateZip].filter(Boolean).join(", ") || null,
            date_of_birth: toIsoDate(f.dob),
            client_profile: Object.keys(cpPatch).length ? cpPatch : null,
          };
          const { data: newLead, error: insErr } = await supabase
            .from("leadjig_leads")
            .insert(payload)
            .select("id")
            .single();
          if (insErr || !newLead) throw insErr || new Error("Insert returned no row");
          created++;
          await uploadToLead((newLead as any).id, u.filename, u.blob, token, i);
        } catch (e: any) {
          failures.push({ filename: u.filename, error: `[create-contact] ${e?.message || String(e)}` });
        }
        i++;
        setProgress({ done: i, total, failures: [...failures], created });
      }
    }

    setUploading(false);
    const ok = total - failures.length;
    if (failures.length === 0) toast.success(`Uploaded ${ok} files · enriched ${enriched} existing · created ${created} new`);
    else toast.error(`Uploaded ${ok} / ${total} · enriched ${enriched} · created ${created} · ${failures.length} failed`);
  };

  const csv = useMemo(() => {
    const rows = [["status", "filename", "parsed_last", "parsed_first", "lead_id", "matched_name", "matched_email", "note"]];
    matched.forEach((m) => rows.push(["matched", m.filename, "", "", m.lead_id, m.name, m.email ?? "", ""]));
    ambiguous.forEach((a) => rows.push(["ambiguous", a.filename, "", "", "", a.candidates.map((c) => `${c.name} (${c.id})`).join(" | "), "", a.note ?? ""]));
    unmatched.forEach((u) => rows.push([
      "unmatched", u.filename, u.last, u.first, "",
      u.fields.primaryName ?? "", u.fields.email ?? "",
      `phone=${u.fields.phone ?? ""}; spouse=${u.fields.spouseName ?? ""}; dob=${u.fields.dob ?? ""}`,
    ]));
    return rows.map((r) => r.map((c) => `"${(c ?? "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
  }, [matched, ambiguous, unmatched]);

  const downloadCsv = () => {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "crm-match-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalToProcess = matched.length + (createMissing ? unmatched.length : 0);

  const [migrating, setMigrating] = useState(false);
  const [migrateDryRun, setMigrateDryRun] = useState(true);
  const [migrateResult, setMigrateResult] = useState<any>(null);
  const runMigrateNotes = async () => {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { toast.error("Not signed in"); return; }
      const { data, error } = await cloudSupabase.functions.invoke("admin-migrate-notes-to-financial", {
        body: { dry_run: migrateDryRun, limit: 500 },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error || (data as any)?.error) throw new Error(error?.message || (data as any).error);
      setMigrateResult(data);
      toast.success(`${migrateDryRun ? "Preview" : "Migrated"}: matched ${data.matched}, updated ${data.updated}, failed ${data.failed}`);
    } catch (e: any) {
      toast.error(e?.message || "Migration failed");
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bulk CRM File Upload</h1>
        <p className="text-sm text-muted-foreground">
          Upload a zip of <code>LastName, First_CRM.xlsx</code> files. Matched files attach to existing contacts; unmatched files create a new contact (using name, email, phone, address, DOB, and spouse from the Excel content) and then attach.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Migrate notes → Financial fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Scan every contact whose notes contain retirement-questionnaire data (income, IRA, 401k, mortgage, parents' ages, etc.), move those values into the structured Financial & Family form fields, and remove them from the notes. Start with a dry run.
          </p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={migrateDryRun} onChange={(e) => setMigrateDryRun(e.target.checked)} />
              Dry run (preview only)
            </label>
            <Button onClick={runMigrateNotes} disabled={migrating}>
              {migrating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {migrateDryRun ? "Preview migration" : "Run migration"}
            </Button>
          </div>
          {migrateResult && (
            <div className="text-xs bg-muted rounded p-3 max-h-72 overflow-auto">
              <div className="font-medium mb-1">
                scanned {migrateResult.scanned} · matched {migrateResult.matched} · updated {migrateResult.updated} · failed {migrateResult.failed}
              </div>
              <ul className="space-y-1">
                {(migrateResult.results ?? []).map((r: any, i: number) => (
                  <li key={i}>
                    {r.error
                      ? <span className="text-destructive">{r.id}: {r.error}</span>
                      : <span>{r.name || r.email || r.id} — filled {r.filled} fields</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>


      <Card>
        <CardHeader>
          <CardTitle>1. Select zip</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="file"
            accept=".zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onZipSelected(f);
            }}
            disabled={loading || uploading}
          />
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Parsing zip and matching contacts…
            </div>
          )}
        </CardContent>
      </Card>

      {reportReady && (
        <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-b flex items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-medium text-green-600">{matched.length} matched</span>
            <span className="text-muted-foreground"> · {ambiguous.length} ambiguous · {unmatched.length} unmatched</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs flex items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={createMissing}
                onChange={(e) => setCreateMissing(e.target.checked)}
                disabled={uploading}
              />
              Create contacts for unmatched ({unmatched.length})
            </label>
            <Button onClick={confirmUpload} disabled={!totalToProcess || uploading} size="lg">
              {uploading
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading {progress.done}/{progress.total}…</>
                : `Confirm & process ${totalToProcess} files`}
            </Button>
          </div>
        </div>
      )}

      {reportReady && (
        <Card>
          <CardHeader>
            <CardTitle>2. Match report</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="rounded-md border p-4">
                <div className="text-2xl font-semibold text-green-600">{matched.length}</div>
                <div className="text-xs text-muted-foreground">Matched</div>
              </div>
              <div className="rounded-md border p-4">
                <div className="text-2xl font-semibold text-amber-600">{ambiguous.length}</div>
                <div className="text-xs text-muted-foreground">Ambiguous</div>
              </div>
              <div className="rounded-md border p-4">
                <div className="text-2xl font-semibold text-red-600">{unmatched.length}</div>
                <div className="text-xs text-muted-foreground">Unmatched {createMissing ? "(will create)" : ""}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={downloadCsv}>Download CSV report</Button>
            </div>

            {ambiguous.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Ambiguous ({ambiguous.length})</summary>
                <ul className="mt-2 space-y-1 max-h-80 overflow-auto">
                  {ambiguous.map((a) => (
                    <li key={a.filename} className="border-b py-1">
                      <div className="font-mono text-xs">{a.filename}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.note ? `(${a.note}) ` : ""}
                        {a.candidates.map((c) => `${c.name}${c.email ? ` <${c.email}>` : ""}`).join(" | ")}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {unmatched.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">
                  Unmatched ({unmatched.length}) {createMissing ? "— will be created as new contacts" : ""}
                </summary>
                <ul className="mt-2 space-y-1 max-h-80 overflow-auto">
                  {unmatched.map((u) => (
                    <li key={u.filename} className="border-b py-1">
                      <div className="font-mono text-xs">{u.filename}</div>
                      <div className="text-xs text-muted-foreground">
                        parsed: last="{u.last}" first="{u.first}" · excel:
                        {" "}name="{u.fields.primaryName ?? "—"}"
                        {" "}spouse="{u.fields.spouseName ?? "—"}"
                        {" "}email="{u.fields.email ?? "—"}"
                        {" "}phone="{u.fields.phone ?? "—"}"
                        {" "}dob="{u.fields.dob ?? "—"}"
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {(progress.failures.length > 0 || progress.created > 0) && (
              <details className="text-sm" open>
                <summary className="cursor-pointer font-medium">
                  {progress.created > 0 && <span className="text-green-600">Created {progress.created} new contacts</span>}
                  {progress.failures.length > 0 && <span className="text-red-600"> · {progress.failures.length} failures</span>}
                </summary>
                <ul className="mt-2 space-y-1 max-h-80 overflow-auto">
                  {progress.failures.map((f) => (
                    <li key={f.filename} className="border-b py-1">
                      <div className="font-mono text-xs">{f.filename}</div>
                      <div className="text-xs text-red-600">{f.error}</div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
