import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, stageToLabel } from "@/lib/supabase";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Mail, MessageSquare, Cake, ExternalLink, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const emailBodyFor = (firstName: string) => `Dear ${firstName},

Today is your day, and we didn't want it to pass without reaching out to say — Happy Birthday! 🎉

Here at Retirement Right, we consider it a privilege to be part of your journey toward a secure and fulfilling retirement. On a day like today, we hope you're surrounded by the people and moments that matter most to you.

As you celebrate another year, we also want to remind you that your retirement future deserves the same attention. Whether you're fine-tuning your Social Security strategy, reviewing your income plan, or just want a second set of eyes on where things stand — we're always just a call away.

🎁 As our birthday gift to you: If you'd like a complimentary retirement check-in this month, just reply to this email or call us directly — no agenda, just a friendly conversation.

Enjoy every moment of your special day!

With warm regards,
The Eberhardt Family | Retirement Right | www.retirement-right.com | Serving Arizona Families`;

const smsStandardFor = (firstName: string) =>
  `Happy Birthday ${firstName}! 🎂 Wishing you a wonderful day from all of us at Retirement Right. As a birthday gift, we'd love to offer you a complimentary retirement check-in this month — no agenda, just a friendly conversation. Reply or call us anytime! — The Eberhardt Family | www.retirement-right.com`;

const smsPersonalFor = (firstName: string) =>
  `Hi ${firstName}, it's Michael Eberhardt at Retirement Right 🎉 Just wanted to wish you a very Happy Birthday today! Hope it's a great one. If there's anything we can do for you this month — even just a quick check-in on your retirement plan — we're always here. Enjoy your day!`;

const isPersonalStage = (stageLabel?: string | null) => {
  const s = (stageLabel ?? "").toLowerCase().trim();
  return s === "hot lead" || s === "client";
};

const smsBodyFor = (firstName: string, stageLabel?: string | null) =>
  isPersonalStage(stageLabel) ? smsPersonalFor(firstName) : smsStandardFor(firstName);

const emailSubjectFor = (firstName: string) => `🎂 Happy Birthday, ${firstName}! A Special Note from the Eberhardt Family`;

type Range = "week" | "month" | "byMonth";

interface BirthdayRow {
  contactId: string;
  personKind: "primary" | "spouse";
  firstName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  month: number;
  day: number;
  year?: number | null;
  nextBirthday: Date;
  ageTurning: number | null;
  lifecycleStage: string | null;
  lifecycleLabel: string;
}

interface LogEntry {
  id: string;
  contact_id: string;
  contact_name: string | null;
  outreach_type: "email" | "sms";
  sent_at: string;
  sent_by: string | null;
  year_sent: number;
  person_kind: "primary" | "spouse";
  recipient: string | null;
}

const parseDob = (s: any): { y: number | null; m: number; d: number } | null => {
  if (!s) return null;
  const str = String(s);
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};

const nextBirthdayDate = (month: number, day: number): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();
  let d = new Date(thisYear, month - 1, day);
  if (d < today) d = new Date(thisYear + 1, month - 1, day);
  return d;
};

const ageOn = (birthYear: number | null, on: Date): number | null => {
  if (!birthYear) return null;
  return on.getFullYear() - birthYear;
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function Birthdays() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BirthdayRow[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [range, setRange] = useState<Range>("week");
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [sending, setSending] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: BirthdayRow; type: "email" | "sms" } | null>(null);
  const currentYear = new Date().getFullYear();

  const loadLog = async () => {
    const { data } = await cloudSupabase
      .from("birthday_outreach_log" as any)
      .select("*")
      .order("sent_at", { ascending: false });
    setLog(((data as unknown) as LogEntry[]) ?? []);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all: any[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("leadjig_leads")
          .select("id,name,email,phone,date_of_birth,raw_payload,client_profile,lifecycle_stage")
          .range(from, from + 999);
        if (error) {
          toast.error(error.message);
          break;
        }
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < 1000) break;
        from += 1000;
      }
      const out: BirthdayRow[] = [];
      for (const l of all) {
        const rp = l.raw_payload || {};
        const cp = l.client_profile || {};
        const fn = String(rp.first_name || (l.name ? String(l.name).split(" ")[0] : "") || "").trim();
        const ln = String(rp.last_name || (l.name ? String(l.name).split(" ").slice(1).join(" ") : "") || "").trim();
        const fullName = [fn, ln].filter(Boolean).join(" ") || l.name || "—";
        const lifecycleStage: string | null = l.lifecycle_stage ?? null;
        const lifecycleLabel = stageToLabel(lifecycleStage);
        const p = parseDob(l.date_of_birth || rp.date_of_birth || rp.birthdate || cp.birthdate);
        if (p) {
          const next = nextBirthdayDate(p.m, p.d);
          out.push({
            contactId: l.id, personKind: "primary",
            firstName: fn || fullName, fullName,
            email: l.email, phone: l.phone,
            month: p.m, day: p.d, year: p.y,
            nextBirthday: next, ageTurning: ageOn(p.y, next),
            lifecycleStage, lifecycleLabel,
          });
        }
        const sp = parseDob(cp.spouse_birthdate);
        if (sp) {
          const spName = String(cp.spouse_name || "").trim() || "(spouse)";
          const spFirst = spName.split(" ")[0] || spName;
          const next = nextBirthdayDate(sp.m, sp.d);
          out.push({
            contactId: l.id, personKind: "spouse",
            firstName: spFirst, fullName: spName,
            email: l.email, phone: l.phone,
            month: sp.m, day: sp.d, year: sp.y,
            nextBirthday: next, ageTurning: ageOn(sp.y, next),
            lifecycleStage, lifecycleLabel,
          });
        }
      }
      setRows(out);
      await loadLog();
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let list: BirthdayRow[];
    if (range === "week") {
      const end = new Date(today); end.setDate(end.getDate() + 7);
      list = rows.filter(r => r.nextBirthday >= today && r.nextBirthday <= end);
    } else if (range === "month") {
      const m = today.getMonth() + 1;
      list = rows.filter(r => r.month === m);
    } else {
      list = rows.filter(r => r.month === selectedMonth);
    }
    return list.sort((a, b) => {
      if (range === "week") return a.nextBirthday.getTime() - b.nextBirthday.getTime();
      return a.day - b.day;
    });
  }, [rows, range, selectedMonth]);

  const hasSent = (r: BirthdayRow, type: "email" | "sms") =>
    log.some(e => e.contact_id === r.contactId && e.person_kind === r.personKind && e.outreach_type === type && e.year_sent === currentYear);

  const send = async (r: BirthdayRow, type: "email" | "sms") => {
    const key = `${r.contactId}-${r.personKind}-${type}`;
    setSending(key);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const fn = type === "email" ? "send-birthday-email" : "send-birthday-sms";
      const payload: any = {
        contactId: r.contactId,
        personKind: r.personKind,
        firstName: r.firstName,
        contactName: r.fullName,
      };
      if (type === "email") payload.email = r.email;
      else {
        payload.phone = r.phone;
        payload.lifecycleStage = r.lifecycleLabel;
      }
      const { data, error } = await cloudSupabase.functions.invoke(fn, {
        body: payload,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      if (data && (data as any).success === false) throw new Error((data as any).error || "Send failed");
      toast.success(`Birthday ${type === "email" ? "email" : "SMS"} sent to ${r.firstName}!`, {
        className: "bg-emerald-600 text-white border-emerald-700",
      });
      await loadLog();
    } catch (e: any) {
      toast.error(e?.message || "Send failed");
    } finally {
      setSending(null);
    }
  };

  const fmtBday = (r: BirthdayRow) => `${MONTHS[r.month - 1].slice(0, 3)} ${r.day}${r.year ? `, ${r.year}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Cake className="h-6 w-6" /> Birthdays</h1>
      </div>

      <Tabs defaultValue="birthdays">
        <TabsList>
          <TabsTrigger value="birthdays">Birthdays</TabsTrigger>
          <TabsTrigger value="sentToday">Sent Today</TabsTrigger>
          <TabsTrigger value="history">Outreach History</TabsTrigger>
        </TabsList>

        <TabsContent value="birthdays" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant={range === "week" ? "default" : "outline"} onClick={() => setRange("week")}>This Week</Button>
                  <Button size="sm" variant={range === "month" ? "default" : "outline"} onClick={() => setRange("month")}>This Month</Button>
                  <Button size="sm" variant={range === "byMonth" ? "default" : "outline"} onClick={() => setRange("byMonth")}>By Month</Button>
                  {range === "byMonth" && (
                    <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <span className="text-sm text-muted-foreground">{filtered.length} {filtered.length === 1 ? "person" : "people"}</span>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-12 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : filtered.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">No birthdays in this range.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>Birthday</TableHead>
                      <TableHead>Age Turning</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => {
                      const emailSent = hasSent(r, "email");
                      const smsSent = hasSent(r, "sms");
                      const key = `${r.contactId}-${r.personKind}`;
                      return (
                        <TableRow key={`${key}-${r.month}-${r.day}`}>
                          <TableCell className="font-medium">{r.fullName}</TableCell>
                          <TableCell>
                            <Badge variant={r.personKind === "primary" ? "default" : "secondary"}>
                              {r.personKind === "primary" ? "Primary" : "Spouse"}
                            </Badge>
                          </TableCell>
                          <TableCell>{fmtBday(r)}</TableCell>
                          <TableCell>{r.ageTurning ?? "—"}</TableCell>
                          <TableCell>{r.phone || "—"}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{r.email || "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center gap-1.5 justify-end flex-wrap">
                              {emailSent && <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"><CheckCircle2 className="h-3 w-3" />Email Sent</Badge>}
                              {smsSent && <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"><CheckCircle2 className="h-3 w-3" />SMS Sent</Badge>}
                              {r.email && !emailSent && (
                                <Button size="sm" variant="outline" disabled={sending === `${key}-email`} onClick={() => setConfirm({ row: r, type: "email" })}>
                                  {sending === `${key}-email` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                                  Email
                                </Button>
                              )}
                              {r.phone && !smsSent && (
                                <Button size="sm" variant="outline" disabled={sending === `${key}-sms`} onClick={() => setConfirm({ row: r, type: "sms" })}>
                                  {sending === `${key}-sms` ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
                                  SMS
                                </Button>
                              )}
                              <Link to={`/contacts/${r.contactId}`}>
                                <Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button>
                              </Link>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sentToday">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Birthday Outreach — Sent Today</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                const sentToday = log.filter(e => {
                  const sent = new Date(e.sent_at);
                  return sent >= today && sent < tomorrow;
                });
                if (sentToday.length === 0) {
                  return <div className="py-12 text-center text-muted-foreground text-sm">No birthday outreach sent today.</div>;
                }
                return (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Who</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Sent At</TableHead>
                        <TableHead>Sent By</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sentToday.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="font-medium">{e.contact_name || "—"}</TableCell>
                          <TableCell><Badge variant={e.person_kind === "primary" ? "default" : "secondary"}>{e.person_kind === "primary" ? "Primary" : "Spouse"}</Badge></TableCell>
                          <TableCell><Badge variant="outline">{e.outreach_type.toUpperCase()}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.recipient || "—"}</TableCell>
                          <TableCell>{new Date(e.sent_at).toLocaleString()}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.sent_by || "—"}</TableCell>
                          <TableCell><Link to={`/contacts/${e.contact_id}`}><Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button></Link></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle>Outreach History</CardTitle></CardHeader>
            <CardContent>
              {log.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">No birthday outreach yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Sent By</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {log.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.contact_name || "—"}</TableCell>
                        <TableCell><Badge variant={e.person_kind === "primary" ? "default" : "secondary"}>{e.person_kind === "primary" ? "Primary" : "Spouse"}</Badge></TableCell>
                        <TableCell><Badge variant="outline">{e.outreach_type.toUpperCase()}</Badge></TableCell>
                        <TableCell>{new Date(e.sent_at).toLocaleString()}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.sent_by || "—"}</TableCell>
                        <TableCell><Link to={`/contacts/${e.contact_id}`}><Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button></Link></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirm?.type === "email" ? <Mail className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
              Send Birthday {confirm?.type === "email" ? "Email" : "SMS"} to {confirm?.row.firstName}?
            </DialogTitle>
            <DialogDescription>
              {confirm?.type === "email"
                ? <>To: <span className="font-medium text-foreground">{confirm?.row.email}</span></>
                : <>To: <span className="font-medium text-foreground">{confirm?.row.phone}</span></>}
            </DialogDescription>
          </DialogHeader>
          {confirm && (
            <div className="overflow-y-auto rounded-md border bg-muted/30 p-4 text-sm">
              {confirm.type === "email" && (
                <div className="mb-3 pb-3 border-b">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Subject</div>
                  <div className="font-medium">{emailSubjectFor(confirm.row.firstName)}</div>
                </div>
              )}
              <pre className="whitespace-pre-wrap font-sans leading-relaxed">
                {confirm.type === "email" ? emailBodyFor(confirm.row.firstName) : smsBodyFor(confirm.row.firstName, confirm.row.lifecycleLabel)}
              </pre>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={!!sending}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!confirm) return;
                const { row, type } = confirm;
                setConfirm(null);
                await send(row, type);
              }}
              disabled={!!sending}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Confirm Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
