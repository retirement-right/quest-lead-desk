import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Bell, Calendar, LogOut, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { supabase, Lead } from "@/lib/supabase";
import { format, startOfDay, endOfDay, isBefore } from "date-fns";
import { toast } from "sonner";
import { useFailedSyncs } from "@/hooks/useFailedSyncs";


interface DueItem {
  id: string;
  name: string;
  type: string;
  date: Date;
  overdue: boolean;
}

const fullName = (l: Lead) => {
  const rp = (l.raw_payload ?? {}) as Record<string, any>;
  const fp = [rp.first_name, rp.last_name].filter(Boolean).join(" ");
  return fp || l.name || "—";
};

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const loc = useLocation();
  const [items, setItems] = useState<DueItem[]>([]);
  const alertedRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const CHUNK = 1000;
      let from = 0;
      const all: Lead[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("leadjig_leads")
          .select("id, name, raw_payload, client_profile")
          .not("client_profile", "is", null)
          .range(from, from + CHUNK - 1);
        if (error) break;
        const batch = (data ?? []) as Lead[];
        all.push(...batch);
        if (batch.length < CHUNK) break;
        from += CHUNK;
      }
      if (cancelled) return;
      const today = startOfDay(new Date());
      const todayEnd = endOfDay(new Date());
      const due: DueItem[] = [];
      for (const l of all) {
        const cp = (l.client_profile ?? {}) as Record<string, any>;
        const t = String(cp.followup_type || "");
        if (t !== "Call" && t !== "In Person") continue;
        if ((cp.followup_status ?? "Pending") !== "Pending") continue;
        if (!cp.followup_date) continue;
        const d = new Date(cp.followup_date);
        if (isNaN(d.getTime())) continue;
        if (d > todayEnd) continue;
        due.push({
          id: l.id,
          name: fullName(l),
          type: t,
          date: d,
          overdue: isBefore(d, today),
        });
      }
      due.sort((a, b) => a.date.getTime() - b.date.getTime());
      setItems(due);

      if (!alertedRef.current && due.length > 0) {
        alertedRef.current = true;
        toast(`You have ${due.length} follow-up${due.length === 1 ? "" : "s"} due today`, {
          description: "Click to view your follow-ups",
          action: { label: "View", onClick: () => (window.location.href = "/follow-ups") },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const count = items.length;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground grid place-items-center text-xs">
              LJ
            </div>
            Leadjig CRM
          </Link>
          <nav className="flex items-center gap-1">
            <Link to="/">
              <Button variant={loc.pathname === "/" ? "secondary" : "ghost"} size="sm">
                <Users className="h-4 w-4" /> Contacts
              </Button>
            </Link>
            <Link to="/follow-ups">
              <Button variant={loc.pathname.startsWith("/follow-ups") ? "secondary" : "ghost"} size="sm">
                <Bell className="h-4 w-4" /> Follow-ups
              </Button>
            </Link>
            <Link to="/appointments">
              <Button variant={loc.pathname.startsWith("/appointments") ? "secondary" : "ghost"} size="sm">
                <Calendar className="h-4 w-4" /> Appointments
              </Button>
            </Link>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="relative" aria-label="Notifications">
                  <Bell className="h-4 w-4" />
                  {count > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold grid place-items-center">
                      {count}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="px-3 py-2 border-b text-sm font-medium">
                  Call & In-Person follow-ups
                </div>
                {count === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    Nothing due today
                  </div>
                ) : (
                  <ul className="max-h-80 overflow-auto divide-y">
                    {items.map((i) => (
                      <li key={i.id}>
                        <Link
                          to={`/contacts/${i.id}`}
                          className="block px-3 py-2 hover:bg-muted/60"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium truncate">{i.name}</span>
                            <Badge
                              variant={i.overdue ? "destructive" : "default"}
                              className={i.overdue ? "" : "bg-orange-500 text-white hover:bg-orange-500/90"}
                            >
                              {i.overdue ? "Overdue" : "Today"}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {i.type} · {format(i.date, "PPp")}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="px-3 py-2 border-t">
                  <Link to="/follow-ups" className="text-xs text-primary hover:underline">
                    View all follow-ups →
                  </Link>
                </div>
              </PopoverContent>
            </Popover>

            <span className="text-xs text-muted-foreground hidden sm:inline ml-3 mr-2">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}
