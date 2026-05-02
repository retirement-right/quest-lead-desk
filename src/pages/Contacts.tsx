import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, Lead, STATUS_OPTIONS, stageToLabel } from "@/lib/supabase";
import { StatusBadge } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search } from "lucide-react";
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

export default function Contacts() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("leadjig_leads")
        .select("*")
        .order("created_at", { ascending: false, nullsFirst: false });
      if (error) toast.error(error.message);
      else setLeads((data ?? []) as Lead[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (status !== "all" && stageToLabel(l.lifecycle_stage) !== status) return false;
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
  }, [leads, q, status]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} of {leads.length} leads</p>
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
              filtered.map((l) => (
                <TableRow key={l.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link to={`/contacts/${l.id}`} className="hover:underline">{fullName(l)}</Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.email || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{l.phone || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{l.event_name || "—"}</TableCell>
                  <TableCell><StatusBadge status={stageToLabel(l.lifecycle_stage)} /></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
