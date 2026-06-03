import { useMemo, useState } from "react";
import JSZip from "jszip";

import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const BUCKET = "lead-documents";

type ParsedFile = { filename: string; last: string; first: string; blob: Blob };
type Lead = { id: string; full: string; first: string; last: string; email?: string | null };
type Matched = { filename: string; lead_id: string; name: string; email?: string | null; blob: Blob };
type Ambiguous = { filename: string; candidates: { id: string; name: string; email?: string | null }[]; note?: string };
type Unmatched = { filename: string; last: string; first: string };

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");

function parseFilename(name: string): { last: string; first: string } {
  // Strip extension and _CRM suffix
  let base = name.replace(/\.xlsx$/i, "").replace(/_CRM$/i, "");
  // Replace underscores with spaces, collapse spaces
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

export default function BulkCrmUpload() {
  const [matched, setMatched] = useState<Matched[]>([]);
  const [ambiguous, setAmbiguous] = useState<Ambiguous[]>([]);
  const [unmatched, setUnmatched] = useState<Unmatched[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failures: { filename: string; error: string }[] }>({
    done: 0,
    total: 0,
    failures: [],
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
        files.push({ filename: fname, last, first, blob });
      }
      toast.success(`Extracted ${files.length} CRM files`);
      const blobByName = new Map(files.map((f) => [f.filename, f.blob]));

      toast.info("Matching contacts via service…");
      const queries = files.map((f) => ({ filename: f.filename, last: f.last, first: f.first }));
      const { data, error } = await cloudSupabase.functions.invoke("crm-match-report", { body: { queries } });
      if (error) throw new Error(error.message || "Match service failed");
      if (data?.error) throw new Error(data.error);

      const m: Matched[] = (data.matched ?? []).map((x: any) => ({
        filename: x.filename,
        lead_id: x.lead_id,
        name: x.name,
        email: x.email,
        blob: blobByName.get(x.filename)!,
      }));
      setMatched(m);
      setAmbiguous(data.ambiguous ?? []);
      setUnmatched(data.unmatched ?? []);
      setPoolSize(data.lead_pool_size ?? null);
      setReportReady(true);
      toast.success(`Matched ${m.length} of ${files.length} (pool: ${data.lead_pool_size})`);
    } catch (e: any) {
      console.error("Bulk CRM upload error:", e);
      toast.error(e?.message || "Failed to parse zip / match contacts");
      setReportReady(true);
    } finally {
      setLoading(false);
    }
  };

  const confirmUpload = async () => {
    if (!matched.length) return;
    if (!confirm(`Upload ${matched.length} files to their matched contacts?`)) return;
    setUploading(true);
    const { data: { user } } = await cloudSupabase.auth.getUser();
    const failures: { filename: string; error: string }[] = [];
    setProgress({ done: 0, total: matched.length, failures: [] });
    for (let i = 0; i < matched.length; i++) {
      const m = matched[i];
      try {
        const safeName = m.filename.replace(/[^\w.\-]+/g, "_");
        const path = `${m.lead_id}/${Date.now()}-${i}-${safeName}`;
        const { error: upErr } = await cloudSupabase.storage.from(BUCKET).upload(path, m.blob, {
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        if (upErr) throw upErr;
        const { error: insErr } = await cloudSupabase.from("lead_documents" as any).insert({
          lead_id: m.lead_id,
          file_name: m.filename,
          file_path: path,
          uploaded_by: user?.id ?? null,
        });
        if (insErr) throw insErr;
      } catch (e: any) {
        failures.push({ filename: m.filename, error: e?.message || String(e) });
      }
      setProgress({ done: i + 1, total: matched.length, failures: [...failures] });
    }
    setUploading(false);
    if (failures.length === 0) toast.success(`Uploaded ${matched.length} files successfully`);
    else toast.error(`Uploaded ${matched.length - failures.length} / ${matched.length}, ${failures.length} failed`);
  };

  const csv = useMemo(() => {
    const rows = [["status", "filename", "parsed_last", "parsed_first", "lead_id", "matched_name", "matched_email", "note"]];
    matched.forEach((m) => rows.push(["matched", m.filename, "", "", m.lead_id, m.name, m.email ?? "", ""]));
    ambiguous.forEach((a) => rows.push(["ambiguous", a.filename, "", "", "", a.candidates.map((c) => `${c.name} (${c.id})`).join(" | "), "", a.note ?? ""]));
    unmatched.forEach((u) => rows.push(["unmatched", u.filename, u.last, u.first, "", "", "", ""]));
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

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bulk CRM File Upload</h1>
        <p className="text-sm text-muted-foreground">
          Upload a zip of <code>LastName, First_CRM.xlsx</code> files. They'll be matched to contacts and uploaded into each contact's Documents section.
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
          <Button onClick={confirmUpload} disabled={!matched.length || uploading} size="lg">
            {uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading {progress.done}/{progress.total}…</> : `Confirm & upload ${matched.length} matched files`}
          </Button>
        </div>
      )}

      {reportReady && (
        <>
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
                  <div className="text-xs text-muted-foreground">Unmatched</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={downloadCsv}>Download CSV report</Button>
                <Button onClick={confirmUpload} disabled={!matched.length || uploading}>
                  {uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading {progress.done}/{progress.total}…</> : `Confirm & upload ${matched.length} matched files`}
                </Button>
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
                  <summary className="cursor-pointer font-medium">Unmatched ({unmatched.length})</summary>
                  <ul className="mt-2 space-y-1 max-h-80 overflow-auto">
                    {unmatched.map((u) => (
                      <li key={u.filename} className="border-b py-1">
                        <div className="font-mono text-xs">{u.filename}</div>
                        <div className="text-xs text-muted-foreground">parsed: last="{u.last}" first="{u.first}"</div>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {progress.failures.length > 0 && (
                <details className="text-sm" open>
                  <summary className="cursor-pointer font-medium text-red-600">Upload failures ({progress.failures.length})</summary>
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
        </>
      )}
    </div>
  );
}
