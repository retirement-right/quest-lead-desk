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
};

type ParsedFile = { filename: string; last: string; first: string; blob: Blob; fields: ExtractedFields };
type Matched = { filename: string; lead_id: string; name: string; email?: string | null; blob: Blob };
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
    };
  } catch (e) {
    console.warn("xlsx parse failed", e);
    return { firstName: fallback.first || null, lastName: fallback.last || null };
  }
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
          m.push({ filename: p.filename, lead_id: firstHits[0].id, name: firstHits[0].full, email: firstHits[0].email, blob: p.blob });
        } else if (firstHits.length > 1) {
          a.push({ filename: p.filename, candidates: firstHits.map((l) => ({ id: l.id, name: l.full, email: l.email })) });
        } else if (lastHits.length === 1) {
          m.push({ filename: p.filename, lead_id: lastHits[0].id, name: lastHits[0].full, email: lastHits[0].email, blob: p.blob });
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
    setProgress({ done: 0, total, failures: [], created: 0 });

    let i = 0;
    for (const m of matched) {
      try {
        await uploadToLead(m.lead_id, m.filename, m.blob, token, i);
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
          const payload: Record<string, any> = {
            name: combinedName,
            raw_payload: {
              first_name: f.firstName || u.first || null,
              last_name: f.lastName || u.last || null,
              spouse_name: f.spouseName || null,
              date_of_birth: f.dob || null,
              city_state_zip: f.cityStateZip || null,
              source: "bulk-crm-upload",
            },
            email: f.email || null,
            phone: f.phone || null,
            address: [f.address, f.cityStateZip].filter(Boolean).join(", ") || null,
            date_of_birth: f.dob || null,
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
    if (failures.length === 0) toast.success(`Uploaded ${ok} files (created ${created} new contacts)`);
    else toast.error(`Uploaded ${ok} / ${total} · ${created} new contacts · ${failures.length} failed`);
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
