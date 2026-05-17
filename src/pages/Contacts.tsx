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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, StickyNote, Trash2, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { cn } from "@/lib/utils";

const fullName = (l: Lead) => {
  const rp = (l as any).raw_payload;
  if (rp) {
    const fromPayload = [rp.first_name, rp.last_name].filter(Boolean).join(" ");
    if (fromPayload) return fromPayload;
  }
  if ((l as any).name) return (l as any).name as string;
  return "—";
};

// Raw lifecycle_stage badge — distinct from the human "Status" column.
// Color picked per stage so hot leads pop visually.
const STAGE_STYLES: Record<string, string> = {
  hot_lead: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30",
  warm_lead: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30",
  cold_lead: "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/30",
  consultation_booked: "bg-status-appointment text-status-appointment-foreground",
  appointment_set: "bg-status-appointment text-status-appointment-foreground",
  new: "bg-muted text-muted-foreground ring-1 ring-border",
  prospect: "bg-muted text-muted-foreground ring-1 ring-border",
  nurture: "bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30",
  client: "bg-status-client text-status-client-foreground",
  lost: "bg-status-not-interested text-status-not-interested-foreground",
  not_interested: "bg-status-not-interested text-status-not-interested-foreground",
  cancelled: "bg-status-cancelled text-status-cancelled-foreground",
};

// Lower number = higher priority when sorting ascending
const STAGE_PRIORITY: Record<string, number> = {
  hot_lead: 0,
  consultation_booked: 1,
  appointment_set: 1,
  warm_lead: 2,
  nurture: 3,
  new: 4,
  prospect: 4,
  cold_lead: 5,
  client: 6,
  lost: 7,
  not_interested: 7,
  cancelled: 8,
};

const stageKey = (l: Lead) => (l.lifecycle_stage ?? "").toLowerCase().trim();
const stageLabel = (s: string) =>
  s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown";
const stagePriority = (l: Lead) => STAGE_PRIORITY[stageKey(l)] ?? 99;

function StageBadge({ stage }: { stage: string }) {
  const cls = STAGE_STYLES[stage] ?? "bg-muted text-muted-foreground ring-1 ring-border";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        cls,
      )}
    >
      {stageLabel(stage)}
    </span>
  );
}


const composedAddress = (l: Lead): string => {
  const rp = ((l as any).raw_payload ?? {}) as Record<string, any>;
  const cp = ((l as any).client_profile ?? {}) as Record<string, any>;
  const top = l as unknown as Record<string, any>;
  // Search top-level columns first (e.g. street_address/city/state/zip_code),
  // then raw_payload, then client_profile.
  const sources = [top, rp, cp];
  const pick = (...keys: string[]) => {
    for (const src of sources) {
      for (const k of keys) {
        const v = src?.[k];
        if (v != null && String(v).trim() !== "") return String(v).trim();
      }
    }
    return "";
  };
  const street = pick(
    "street_address",
    "street",
    "address1",
    "address_line_1",
    "address_line1",
    "addressLine1",
  );
  const city = pick("city", "town");
  const state = pick("state", "region", "province");
  const zip = pick("zip_code", "zip", "postal_code", "postcode", "zipcode");
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ").trim()]
    .filter(Boolean)
    .join(", ");
  const composed = [street, cityStateZip].filter(Boolean).join(", ");
  if (composed) return composed;
  // Fallbacks: a single combined "address" string anywhere
  const combined = pick("address", "full_address", "mailing_address");
  if (combined) return combined;
  return (l.address ?? "").trim();
};



type FollowUpState = "overdue" | "today" | null;

const followUpState = (l: Lead): FollowUpState => {
  const fu = (l.client_profile as any)?.followUp;
  if (!fu?.date) return null;
  if (fu.status && fu.status !== "Pending") return null;
  const due = new Date(fu.date);
  if (isNaN(due.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  if (due < startOfToday) return "overdue";
  if (due < startOfTomorrow) return "today";
  return null;
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
  const [sortRegistered, setSortRegistered] = useState<"none" | "asc" | "desc">("none");
  const [sortStage, setSortStage] = useState<"none" | "asc" | "desc">("none");
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
        composedAddress(l),
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [leads, q, status, optOutOnly]);

  const regTime = (l: Lead): number => {
    const raw = (l.raw_payload as any)?.registration_date || l.created_at;
    if (!raw) return 0;
    const t = new Date(raw).getTime();
    return isNaN(t) ? 0 : t;
  };

  const sorted = useMemo(() => {
    if (sortRegistered === "none") return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => sortRegistered === "asc" ? regTime(a) - regTime(b) : regTime(b) - regTime(a));
    return arr;
  }, [filtered, sortRegistered]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, sorted.length);
  const pageLeads = sorted.slice(startIdx, endIdx);

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
    const combinedName = [first, last].filter(Boolean).join(" ") || null;
    const payload: Record<string, any> = {
      name: combinedName,
      raw_payload: {
        first_name: first || null,
        last_name: last || null,
      },
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

  const handleStatusChange = async (lead: Lead, newStatus: LeadStatus) => {
    const prevStage = lead.lifecycle_stage;
    const newStage = labelToStage(newStatus);
    if (prevStage === newStage) return;
    const prevLabel = stageToLabel(prevStage);
    setLeads((prev) => prev.map((x) => (x.id === lead.id ? { ...x, lifecycle_stage: newStage } : x)));
    const { error } = await supabase
      .from("leadjig_leads")
      .update({ lifecycle_stage: newStage })
      .eq("id", lead.id);
    if (error) {
      setLeads((prev) => prev.map((x) => (x.id === lead.id ? { ...x, lifecycle_stage: prevStage } : x)));
      toast.error(error.message);
    } else {
      toast.success("Status updated");
      const { supabase: cloud } = await import("@/integrations/supabase/client");
      const { data: { user } } = await cloud.auth.getUser();
      await cloud.from("contact_activity" as any).insert({
        lead_id: lead.id,
        type: "status_change",
        channel: "status",
        body: `${prevLabel} → ${newStatus}`,
        status: "ok",
        created_by: user?.id ?? null,
      });
    }
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
          <Link to="/appointments">
            <Button className="bg-status-appointment text-status-appointment-foreground hover:bg-status-appointment/90">
              📅 Appointments
            </Button>
          </Link>
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
              <TableHead>Address</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() =>
                    setSortRegistered((s) => (s === "none" ? "desc" : s === "desc" ? "asc" : "none"))
                  }
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Registered
                  {sortRegistered === "none" && <ArrowUpDown className="h-3.5 w-3.5" />}
                  {sortRegistered === "desc" && <ArrowDown className="h-3.5 w-3.5" />}
                  {sortRegistered === "asc" && <ArrowUp className="h-3.5 w-3.5" />}
                </button>
              </TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No contacts found
                </TableCell>
              </TableRow>
            ) : (
              pageLeads.map((l) => {
                const fu = followUpState(l);
                const currentStatus = stageToLabel(l.lifecycle_stage);
                return (
                <TableRow key={l.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {fu && (
                        <span
                          className={cn(
                            "inline-block h-2.5 w-2.5 rounded-full shrink-0",
                            fu === "overdue" ? "bg-destructive" : "bg-status-appointment",
                          )}
                          title={fu === "overdue" ? "Follow-up overdue" : "Follow-up due today"}
                          aria-label={fu === "overdue" ? "Follow-up overdue" : "Follow-up due today"}
                        />
                      )}
                      <Link to={`/contacts/${l.id}`} className="hover:underline">{fullName(l)}</Link>
                      {l.notes && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs whitespace-pre-wrap">{l.notes}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.email || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{l.phone || "—"}</TableCell>
                  {(() => { const addr = composedAddress(l); return (
                    <TableCell className="text-muted-foreground max-w-[260px] truncate" title={addr}>{addr || "—"}</TableCell>
                  ); })()}
                  <TableCell className="text-muted-foreground">{l.event_name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {(() => {
                      const raw = (l.raw_payload as any)?.registration_date || l.created_at;
                      if (!raw) return "—";
                      const d = new Date(raw);
                      return isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy h:mm a");
                    })()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-full focus:outline-none focus:ring-2 focus:ring-ring"
                            aria-label="Change status"
                          >
                            <StatusBadge status={currentStatus} className="cursor-pointer hover:opacity-80 transition-opacity" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-44 p-1" align="start">
                          <div className="flex flex-col">
                            {STATUS_OPTIONS.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  handleStatusChange(l, s);
                                  (document.activeElement as HTMLElement)?.blur();
                                }}
                                className={cn(
                                  "flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent text-left",
                                  s === currentStatus && "bg-accent/60",
                                )}
                              >
                                <StatusBadge status={s} />
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
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
                );
              })
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
