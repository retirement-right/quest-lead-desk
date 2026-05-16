import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, Lead } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Mail, Phone, Clock } from "lucide-react";
import {
  format,
  startOfDay,
  endOfDay,
  startOfWeek,
  addDays,
  isSameDay,
  addMonths,
  isAfter,
  isBefore,
} from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const fullName = (l: Lead) => {
  const rp = (l.raw_payload ?? {}) as Record<string, any>;
  const fp = [rp.first_name, rp.last_name].filter(Boolean).join(" ");
  return fp || l.name || "—";
};

interface Appt {
  lead: Lead;
  date: Date;
}

const ORANGE_BTN =
  "bg-status-appointment text-status-appointment-foreground hover:bg-status-appointment/90";

export default function Appointments() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [horizon, setHorizon] = useState<"3" | "6" | "9" | "12">("3");
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(undefined);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const CHUNK = 1000;
      let from = 0;
      const all: Lead[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("leadjig_leads")
          .select("id, name, email, phone, raw_payload, appointment_at")
          .not("appointment_at", "is", null)
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

  const appts: Appt[] = useMemo(() => {
    const out: Appt[] = [];
    for (const l of leads) {
      if (!l.appointment_at) continue;
      const d = new Date(l.appointment_at);
      if (isNaN(d.getTime())) continue;
      out.push({ lead: l, date: d });
    }
    return out.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [leads]);

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const todays = appts.filter((a) => a.date >= todayStart && a.date <= todayEnd);

  // Week: Monday → Saturday of current week
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i));
  const weekAppts = (day: Date) =>
    appts.filter((a) => isSameDay(a.date, day));

  // Upcoming
  const horizonEnd = addMonths(todayStart, parseInt(horizon));
  const upcoming = appts.filter(
    (a) => !isBefore(a.date, todayStart) && !isAfter(a.date, horizonEnd),
  );
  const daysWithAppts = upcoming.map((a) => startOfDay(a.date));
  const selectedDayAppts = selectedDay
    ? upcoming.filter((a) => isSameDay(a.date, selectedDay))
    : [];

  const ApptRow = ({ a, showDate = false }: { a: Appt; showDate?: boolean }) => (
    <Link
      to={`/contacts/${a.lead.id}`}
      className="block rounded-lg border bg-card p-3 hover:bg-muted/60 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium truncate">{fullName(a.lead)}</div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {a.lead.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" /> {a.lead.phone}
              </span>
            )}
            {a.lead.email && (
              <span className="inline-flex items-center gap-1 truncate">
                <Mail className="h-3 w-3" /> {a.lead.email}
              </span>
            )}
          </div>
        </div>
        <Badge className={cn(ORANGE_BTN, "shrink-0")}>
          <Clock className="h-3 w-3 mr-1" />
          {showDate ? format(a.date, "MMM d · h:mm a") : format(a.date, "h:mm a")}
        </Badge>
      </div>
    </Link>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : `${appts.length} scheduled`}
          </p>
        </div>
        <Button className={ORANGE_BTN} onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" /> Return to CRM
        </Button>
      </div>

      {loading ? (
        <div className="h-40 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="today" className="w-full">
          <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="week">This Week</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="space-y-3">
            <h2 className="text-sm text-muted-foreground">
              {format(now, "EEEE, MMMM d")}
            </h2>
            {todays.length === 0 ? (
              <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
                No appointments scheduled for today
              </div>
            ) : (
              <div className="space-y-2">
                {todays.map((a) => (
                  <ApptRow key={a.lead.id} a={a} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="week" className="space-y-4">
            <h2 className="text-sm text-muted-foreground">
              Week of {format(weekStart, "MMM d, yyyy")}
            </h2>
            <div className="space-y-4">
              {weekDays.map((day) => {
                const list = weekAppts(day);
                const isToday = isSameDay(day, now);
                return (
                  <div key={day.toISOString()}>
                    <div className="flex items-center gap-2 mb-2">
                      <h3
                        className={cn(
                          "font-semibold",
                          isToday && "text-status-appointment",
                        )}
                      >
                        {format(day, "EEEE")}
                        <span className="text-muted-foreground font-normal ml-2 text-sm">
                          {format(day, "MMM d")}
                        </span>
                      </h3>
                      {list.length > 0 ? (
                        <Badge className={ORANGE_BTN}>
                          {list.length} appointment{list.length === 1 ? "" : "s"}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No appointments
                        </span>
                      )}
                    </div>
                    {list.length > 0 && (
                      <div className="space-y-2 pl-1">
                        {list.map((a) => (
                          <ApptRow key={a.lead.id} a={a} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="upcoming" className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">Show next:</span>
              <Select value={horizon} onValueChange={(v) => setHorizon(v as any)}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 months</SelectItem>
                  <SelectItem value="6">6 months</SelectItem>
                  <SelectItem value="9">9 months</SelectItem>
                  <SelectItem value="12">12 months</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground ml-2">
                {upcoming.length} appointment{upcoming.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-lg border bg-card p-3 flex justify-center">
                <Calendar
                  mode="single"
                  selected={selectedDay}
                  onSelect={setSelectedDay}
                  fromDate={todayStart}
                  toDate={horizonEnd}
                  modifiers={{ hasAppt: daysWithAppts }}
                  modifiersClassNames={{
                    hasAppt:
                      "relative after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-1.5 after:w-1.5 after:rounded-full after:bg-status-appointment",
                  }}
                  className="p-3 pointer-events-auto"
                />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">
                  {selectedDay
                    ? format(selectedDay, "EEEE, MMMM d, yyyy")
                    : "Select a date"}
                </h3>
                {selectedDay ? (
                  selectedDayAppts.length === 0 ? (
                    <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                      No appointments on this day
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedDayAppts.map((a) => (
                        <ApptRow key={a.lead.id} a={a} />
                      ))}
                    </div>
                  )
                ) : (
                  <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                    Tap a highlighted date to see who's scheduled
                  </div>
                )}

                {!selectedDay && upcoming.length > 0 && (
                  <div className="pt-4 space-y-2">
                    <h4 className="text-xs uppercase tracking-wide text-muted-foreground">
                      Next up
                    </h4>
                    {upcoming.slice(0, 5).map((a) => (
                      <ApptRow key={a.lead.id} a={a} showDate />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
