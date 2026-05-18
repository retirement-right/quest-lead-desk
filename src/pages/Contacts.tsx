import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, Lead, STATUS_OPTIONS, stageToLabel, labelToStage, LeadStatus, effectiveLifecycleStage, isAttendedLead } from "@/lib/supabase";
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

const stageKey = (l: Lead) => (effectiveLifecycleStage(l) ?? "").toLowerCase().trim();
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


const seminarVenue = (l: Lead): string | null => {
  const cp = ((l as any).client_profile ?? {}) as Record<string, any>;
  const rp = ((l as any).raw_payload ?? {}) as Record<string, any>;
  const manual = cp.seminar_location ?? cp.venue ?? cp.event_location;
  if (manual && String(manual).trim()) return String(manual).trim();
  const raw =
    rp.venue ?? rp.location ?? rp.event_location ?? rp.event_venue ?? l.event_name ?? null;
  if (!raw) return null;
  let s = String(raw).trim();
  // Take the first chunk before separators like " - ", " | ", " – "
  s = s.split(/\s+[-|–—:]\s+/)[0];
  // Strip trailing date patterns: 2026-05-16, 05/16/2026, May 16, May 16 2026
  s = s.replace(/[\s,(-]*\(?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\)?[\s)]*$/, "");
  s = s.replace(
    /[\s,(-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z.]*\s*\d{1,2}(,?\s*\d{2,4})?\s*\)?\s*$/i,
    "",
  );
  // Strip trailing standalone year
  s = s.replace(/[\s,(-]*\(?(19|20)\d{2}\)?\s*$/, "");
  s = s.replace(/[\s,–—-]+$/, "").trim();
  return s || null;
};

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

      const attendedNeedingRepair = all.filter(
        (l) => isAttendedLead(l) && (l.lifecycle_stage ?? "").toLowerCase().trim() !== "hot_lead",
      );
      if (attendedNeedingRepair.length > 0) {
        const repairIds = attendedNeedingRepair.map((l) => l.id);
        for (let i = 0; i < repairIds.length; i += 100) {
          const ids = repairIds.slice(i, i + 100);
          const { error } = await supabase
            .from("leadjig_leads")
            .update({ lifecycle_stage: "hot_lead" })
            .in("id", ids);
          if (error) {
            console.error("Failed to repair attended lead stages", error);
            break;
          }
        }
        setLeads((prev) =>
          prev.map((l) => (repairIds.includes(l.id) ? { ...l, lifecycle_stage: "hot_lead" } : l)),
        );
      }

      // Clear phantom appointment_at for contacts whose stage is not an
      // appointment-bearing stage. Only "consultation_booked" / "appointment_set"
      // should have an appointment date.
      const APPT_STAGES = new Set(["consultation_booked", "appointment_set"]);
      const phantomAppt = all.filter((l) => {
        if (!l.appointment_at) return false;
        const stage = (l.lifecycle_stage ?? "").toLowerCase().trim();
        // Use repaired stage for attended leads (hot_lead)
        const effective = isAttendedLead(l) ? "hot_lead" : stage;
        return !APPT_STAGES.has(effective);
      });
      if (phantomAppt.length > 0) {
        const apptIds = phantomAppt.map((l) => l.id);
        for (let i = 0; i < apptIds.length; i += 100) {
          const ids = apptIds.slice(i, i + 100);
          const { error } = await supabase
            .from("leadjig_leads")
            .update({ appointment_at: null })
            .in("id", ids);
          if (error) {
            console.error("Failed to clear phantom appointments", error);
            break;
          }
        }
        setLeads((prev) =>
          prev.map((l) => (apptIds.includes(l.id) ? { ...l, appointment_at: null } : l)),
        );
      }

      // Guests / spouses get incorrectly promoted to "consultation_booked"
      // when the BookedIN proxy matches by shared email with the primary
      // attendee. Reset any guest who isn't actually attended back to "new"
      // and clear their phantom appointment.
      const APPT_LIKE = new Set(["consultation_booked", "appointment_set"]);
      const guestRepairs = all.filter((l) => {
        const stage = (l.lifecycle_stage ?? "").toLowerCase().trim();
        if (!APPT_LIKE.has(stage)) return false;
        if (isAttendedLead(l)) return false;
        const name = fullName(l).toLowerCase();
        const isCathy = name.includes("cathy") && name.includes("leon");
        return l.is_guest === true || isCathy;
      });
      if (guestRepairs.length > 0) {
        const ids = guestRepairs.map((l) => l.id);
        for (let i = 0; i < ids.length; i += 100) {
          const slice = ids.slice(i, i + 100);
          const { error } = await supabase
            .from("leadjig_leads")
            .update({ lifecycle_stage: "new", appointment_at: null })
            .in("id", slice);
          if (error) {
            console.error("Failed to reset guest stages", error);
            break;
          }
        }
        setLeads((prev) =>
          prev.map((l) =>
            ids.includes(l.id) ? { ...l, lifecycle_stage: "new", appointment_at: null } : l,
          ),
        );
      }



      // Force-correct Shari Newstead's appointment per BookedIN confirmation
      // (May 26 2026 10:00 AM MST = 17:00 UTC).
      const SHARI_EMAILS = new Set(["sharinewstead@gmail.com", "sharinenewstead@gmail.com"]);
      const CORRECT_SHARI_APPT = "2026-05-26T17:00:00.000Z";
      const shariLeads = all.filter(
        (l) => l.email && SHARI_EMAILS.has(l.email.trim().toLowerCase()) && l.appointment_at !== CORRECT_SHARI_APPT,
      );
      if (shariLeads.length > 0) {
        const ids = shariLeads.map((l) => l.id);
        const { error } = await supabase
          .from("leadjig_leads")
          .update({ appointment_at: CORRECT_SHARI_APPT, lifecycle_stage: "consultation_booked" })
          .in("id", ids);
        if (error) {
          console.error("Failed to fix Shari's appointment", error);
        } else {
          setLeads((prev) =>
            prev.map((l) =>
              ids.includes(l.id)
                ? { ...l, appointment_at: CORRECT_SHARI_APPT, lifecycle_stage: "consultation_booked" }
                : l,
            ),
          );
        }
      }

      // --- One-off data corrections ---------------------------------------

      // 1) Queen Creek seminar event_date was imported as 2026-05-15 but the
      //    actual event was 2026-05-16. Backfill any lead whose event_date
      //    falls on 2026-05-15 to 2026-05-16 (preserve original time-of-day).
      const wrongDateLeads = all.filter((l) => {
        if (!l.event_date) return false;
        const d = new Date(l.event_date);
        if (isNaN(d.getTime())) return false;
        // Compare on UTC date portion
        return l.event_date.slice(0, 10) === "2026-05-15";
      });
      if (wrongDateLeads.length > 0) {
        const updates = wrongDateLeads.map((l) => ({
          id: l.id,
          newDate: (l.event_date as string).replace("2026-05-15", "2026-05-16"),
        }));
        for (const u of updates) {
          const { error } = await supabase
            .from("leadjig_leads")
            .update({ event_date: u.newDate })
            .eq("id", u.id);
          if (error) {
            console.error("Failed to fix Queen Creek event_date", error);
            break;
          }
        }
        const fixMap = new Map(updates.map((u) => [u.id, u.newDate]));
        setLeads((prev) =>
          prev.map((l) => (fixMap.has(l.id) ? { ...l, event_date: fixMap.get(l.id)! } : l)),
        );
      }

      // 2) John Hooper is a guest with no real appointment — reset to "new".
      const johnHoopers = all.filter((l) => {
        const name = fullName(l).toLowerCase();
        return name.includes("john") && name.includes("hooper");
      });
      if (johnHoopers.length > 0) {
        const ids = johnHoopers.map((l) => l.id);
        const { error } = await supabase
          .from("leadjig_leads")
          .update({ lifecycle_stage: "new", appointment_at: null })
          .in("id", ids);
        if (error) {
          console.error("Failed to reset John Hooper", error);
        } else {
          setLeads((prev) =>
            prev.map((l) =>
              ids.includes(l.id) ? { ...l, lifecycle_stage: "new", appointment_at: null } : l,
            ),
          );
        }
      }

      // 3 & 4) Merge duplicates for Cathy Leon and Shari Newstead.
      //   Strategy: pick a keeper (prefers a record with appointment_at, else
      //   oldest by created_at) and delete the other duplicates. For Shari we
      //   also ensure the keeper has the correct BookedIN appointment.
      const mergeGroups: Array<{
        match: (l: Lead) => boolean;
        keeperUpdate?: Record<string, any>;
      }> = [
        {
          match: (l) => {
            const n = fullName(l).toLowerCase();
            return n.includes("cathy") && n.includes("leon");
          },
        },
        {
          match: (l) => {
            const n = fullName(l).toLowerCase();
            const e = (l.email ?? "").toLowerCase();
            return (
              (n.includes("shari") && n.includes("newstead")) ||
              SHARI_EMAILS.has(e.trim())
            );
          },
          keeperUpdate: {
            appointment_at: CORRECT_SHARI_APPT,
            lifecycle_stage: "consultation_booked",
          },
        },
      ];
      for (const g of mergeGroups) {
        const group = all.filter(g.match);
        if (group.length < 2) {
          // Still apply keeperUpdate to the single record if present
          if (group.length === 1 && g.keeperUpdate) {
            await supabase
              .from("leadjig_leads")
              .update(g.keeperUpdate)
              .eq("id", group[0].id);
          }
          continue;
        }
        const sorted = [...group].sort((a, b) => {
          const aHas = a.appointment_at ? 1 : 0;
          const bHas = b.appointment_at ? 1 : 0;
          if (aHas !== bHas) return bHas - aHas;
          const aT = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bT = b.created_at ? new Date(b.created_at).getTime() : 0;
          return aT - bT;
        });
        const keeper = sorted[0];
        const dupes = sorted.slice(1);
        if (g.keeperUpdate) {
          await supabase
            .from("leadjig_leads")
            .update(g.keeperUpdate)
            .eq("id", keeper.id);
        }
        const dupeIds = dupes.map((d) => d.id);
        const { error: delErr } = await supabase
          .from("leadjig_leads")
          .delete()
          .in("id", dupeIds);
        if (delErr) {
          console.error("Failed to delete duplicate leads", delErr);
        } else {
          setLeads((prev) =>
            prev
              .filter((l) => !dupeIds.includes(l.id))
              .map((l) =>
                l.id === keeper.id && g.keeperUpdate ? { ...l, ...g.keeperUpdate } : l,
              ),
          );
        }
      }
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
      if (status !== "all" && stageToLabel(effectiveLifecycleStage(l)) !== status) return false;
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
    if (sortStage !== "none") {
      const arr = [...filtered];
      arr.sort((a, b) => {
        const diff = stagePriority(a) - stagePriority(b);
        return sortStage === "asc" ? diff : -diff;
      });
      return arr;
    }
    if (sortRegistered === "none") return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => sortRegistered === "asc" ? regTime(a) - regTime(b) : regTime(b) - regTime(a));
    return arr;
  }, [filtered, sortRegistered, sortStage]);

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
    let newStage = labelToStage(newStatus);
    if (isAttendedLead(lead) && newStage === "new") newStage = "hot_lead";
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
              <TableHead>
                <button
                  type="button"
                  onClick={() =>
                    setSortStage((s) => (s === "none" ? "asc" : s === "asc" ? "desc" : "none"))
                  }
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Stage
                  {sortStage === "none" && <ArrowUpDown className="h-3.5 w-3.5" />}
                  {sortStage === "asc" && <ArrowUp className="h-3.5 w-3.5" />}
                  {sortStage === "desc" && <ArrowDown className="h-3.5 w-3.5" />}
                </button>
              </TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center">
                  <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  No contacts found
                </TableCell>
              </TableRow>
            ) : (
              pageLeads.map((l) => {
                const fu = followUpState(l);
                const currentStatus = stageToLabel(effectiveLifecycleStage(l));
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
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {(() => {
                      const venue = seminarVenue(l);
                      const seminar = l.event_date ? new Date(l.event_date) : null;
                      const dateStr = seminar && !isNaN(seminar.getTime()) ? format(seminar, "MM/dd/yyyy") : null;
                      if (!venue && !dateStr) return "—";
                      return (
                        <div className="flex flex-col leading-tight">
                          <span>{venue || "—"}</span>
                          <span className="text-xs text-foreground/70">{dateStr || "—"}</span>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {(() => {
                      const seminar = l.event_date ? new Date(l.event_date) : null;
                      const seminarStr = seminar && !isNaN(seminar.getTime()) ? format(seminar, "MM/dd/yyyy") : "—";
                      const appt = l.appointment_at ? new Date(l.appointment_at) : null;
                      const apptStr = appt && !isNaN(appt.getTime()) ? format(appt, "MM/dd/yyyy h:mm a") : null;
                      return (
                        <div className="flex flex-col leading-tight">
                          <span>{seminarStr}</span>
                          {apptStr && <span className="text-xs text-foreground/70">{apptStr}</span>}
                        </div>
                      );
                    })()}
                  </TableCell>

                  <TableCell>
                    <StageBadge stage={stageKey(l)} />
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
