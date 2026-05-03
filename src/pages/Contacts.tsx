import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, Lead, STATUS_OPTIONS, stageToLabel, labelToStage, LeadStatus } from "@/lib/supabase";
import { StatusBadge } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const fullName = (l: Lead) => {
  const direct = [l.first_name, l.last_name].filter(Boolean).join(" ");
  if (direct) return direct;
  if ((l as any).name) return (l as any).name as string;
  const rp = (l as any).raw_payload;
  if (rp) {
    const fromPayload = [rp.first_name, rp.last_name].filter(Boolean).join(" ");
    if (fromPayload) return fromPayload;
  }
  return "—";
};

const emptyForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  address: "",
  status: "Prospect" as LeadStatus,
  notes: "",
};

export default function Contacts() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [optOutOnly, setOptOutOnly] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const PAGE_SIZE = 50;

  const loadLeads = async () => {
    setLoading(true);
    const CHUNK = 1000;
    let from = 0;
    const all: Lead[] = [];
    let firstError: string | null = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from("leadjig_leads")
        .select("*")
        .order("created_at", { ascending: false, nullsFirst: false })
        .range(from, from + CHUNK - 1);
      if (error) {
        firstError = error.message;
        break;
      }
      const batch = (data ?? []) as Lead[];
      all.push(...batch);
      if (batch.length < CHUNK) break;
      from += CHUNK;
    }
    if (firstError) {
      toast.error(firstError);
    } else {
      const seen = new Set<string>();
      const deduped: Lead[] = [];
      for (const l of all) {
        const key = l.email ? l.email.trim().toLowerCase() : `__no_email__:${l.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(l);
      }
      setLeads(deduped);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadLeads();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [q, status, optOutOnly]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (status !== "all" && stageToLabel(l.lifecycle_stage) !== status) return false;
      if (optOutOnly && !l.do_not_email) return false;
      if (!needle) return true;
      return [
        fullName(l),
        l.email,
        l.phone,
        l.event_name,
        l.address,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [leads, q, status, optOutOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, filtered.length);
  const pageLeads = filtered.slice(startIdx, endIdx);

  const handleSave = async () => {
    const first = form.first_name.trim();
    const last = form.last_name.trim();
    const email = form.email.trim();

    if (!first && !last && !email) {
      toast.error("Please provide at least a name or email");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Please enter a valid email");
      return;
    }

    setSaving(true);
    const payload: Record<string, any> = {
      first_name: first || null,
      last_name: last || null,
      email: email || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      lifecycle_stage: labelToStage(form.status),
      notes: form.notes.trim() || null,
    };

    const { data, error } = await supabase
      .from("leadjig_leads")
      .insert(payload)
      .select()
      .single();

    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Contact created");
    setOpen(false);
    setForm(emptyForm);
    if (data) setLeads((prev) => [data as Lead, ...prev]);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase
      .from("leadjig_leads")
      .delete()
      .eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setLeads((prev) => prev.filter((l) => l.id !== deleteTarget.id));
    toast.success("Contact deleted");
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length === 0
              ? `0 of ${leads.length.toLocaleString()} leads`
              : `Showing ${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${filtered.length.toLocaleString()}${filtered.length !== leads.length ? ` (filtered from ${leads.length.toLocaleString()})` : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, email, phone, event…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8 w-72"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={optOutOnly ? "default" : "outline"}
            onClick={() => setOptOutOnly((v) => !v)}
          >
            Newsletter Opt-Out
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Contact
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No contacts found
                </TableCell>
              </TableRow>
            ) : (
              pageLeads.map((l) => (
                <TableRow key={l.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link to={`/contacts/${l.id}`} className="hover:underline">{fullName(l)}</Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.email || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{l.phone || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{l.event_name || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={stageToLabel(l.lifecycle_stage)} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setDeleteTarget(l);
                        }}
                        aria-label="Delete contact"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(emptyForm); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Contact</DialogTitle>
            <DialogDescription>Manually create a new lead.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="first_name">First name</Label>
                <Input
                  id="first_name"
                  value={form.first_name}
                  maxLength={100}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="last_name">Last name</Label>
                <Input
                  id="last_name"
                  value={form.last_name}
                  maxLength={100}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                maxLength={255}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={form.phone}
                maxLength={50}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={form.address}
                maxLength={255}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as LeadStatus })}
              >
                <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={3}
                value={form.notes}
                maxLength={2000}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {deleteTarget ? fullName(deleteTarget) : "this contact"}
              {deleteTarget?.email ? ` (${deleteTarget.email})` : ""}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
