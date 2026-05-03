import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, Lead } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { format, parseISO, startOfDay, isBefore, isEqual } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type FollowupStatus = "Pending" | "Completed" | "Cancelled";

interface FollowupRow {
  lead: Lead;
  date: Date;
  type: string;
  notes: string;
  status: FollowupStatus;
}

const fullName = (l: Lead) => {
  const direct = [l.first_name, l.last_name].filter(Boolean).join(" ");
  if (direct) return direct;
  if (l.name) return l.name;
  return "—";
};

export default function FollowUps() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"Pending" | "Completed" | "All">("Pending");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const CHUNK = 1000;
      let from = 0;
      const all: Lead[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("leadjig_leads")
          .select("*")
          .not("client_profile", "is", null)
          .range(from, from + CHUNK - 1);
        if (error) {
          toast.error(error.message);
          break;
        }
        const batch = (data ?? []) as Lead[];
        all.push(...batch);
        if (batch.length < CHUNK) break;
        from += CHUNK;
      }
      setLeads(all);
      setLoading(false);
    })();
  }, []);

  const rows: FollowupRow[] = useMemo(() => {
    const out: FollowupRow[] = [];
    for (const l of leads) {
      const cp = (l.client_profile ?? {}) as Record<string, any>;
      const dateStr = cp.followup_date as string | undefined;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) continue;
      out.push({
        lead: l,
        date: d,
        type: cp.followup_type ?? "—",
        notes: cp.followup_notes ?? "",
        status: (cp.followup_status as FollowupStatus) ?? "Pending",
      });
    }
    return out
      .filter((r) => statusFilter === "All" || r.status === statusFilter)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [leads, statusFilter]);

  const today = startOfDay(new Date());

  const rowClass = (r: FollowupRow) => {
    if (r.status !== "Pending") return "";
    const day = startOfDay(r.date);
    if (isBefore(day, today)) return "bg-destructive/10 hover:bg-destructive/15";
    if (isEqual(day, today)) return "bg-orange-500/10 hover:bg-orange-500/15";
    return "";
  };

  const rowBadge = (r: FollowupRow) => {
    if (r.status !== "Pending") return null;
    const day = startOfDay(r.date);
    if (isBefore(day, today))
      return <Badge variant="destructive" className="ml-2">Overdue</Badge>;
    if (isEqual(day, today))
      return <Badge className="ml-2 bg-orange-500 text-white hover:bg-orange-500/90">Today</Badge>;
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Follow-ups</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "follow-up" : "follow-ups"}
          </p>
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Completed">Completed</SelectItem>
            <SelectItem value="All">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Follow-up date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Notes</TableHead>
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
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No follow-ups
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.lead.id} className={cn("cursor-pointer", rowClass(r))}>
                  <TableCell className="font-medium">
                    <Link to={`/contacts/${r.lead.id}`} className="hover:underline">
                      {fullName(r.lead)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link to={`/contacts/${r.lead.id}`} className="block">
                      {format(r.date, "PPp")}
                      {rowBadge(r)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link to={`/contacts/${r.lead.id}`} className="block">{r.type}</Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-md">
                    <Link to={`/contacts/${r.lead.id}`} className="block truncate">
                      {r.notes || "—"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link to={`/contacts/${r.lead.id}`} className="block">
                      <Badge variant={r.status === "Completed" ? "secondary" : r.status === "Cancelled" ? "outline" : "default"}>
                        {r.status}
                      </Badge>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
