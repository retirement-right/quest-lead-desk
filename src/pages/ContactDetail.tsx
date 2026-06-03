import { useEffect, useState, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { supabase, Lead, LeadDocument, STATUS_OPTIONS, stageToLabel, labelToStage, NET_WORTH_OPTIONS, PRIMARY_CONCERN_OPTIONS, effectiveLifecycleStage, isAttendedLead } from "@/lib/supabase";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";
import { ArrowLeft, CalendarIcon, Download, FileScan, Loader2, Mail, MessageSquare, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const ReadOnly = ({ label, value }: { label: string; value?: string | null }) => (
  <div className="space-y-1.5">
    <Label className="text-muted-foreground">{label}</Label>
    <div className="text-sm rounded-md border bg-muted/40 px-3 py-2 min-h-10">
      {value || <span className="text-muted-foreground">—</span>}
    </div>
  </div>
);

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const [lead, setLead] = useState<Lead | null>(null);
  const [docs, setDocs] = useState<LeadDocument[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);

  // editable fields
  const [status, setStatus] = useState<string>("");
  const [appointment, setAppointment] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [birthdate, setBirthdate] = useState<Date | undefined>(undefined);
  const [receivesNewsletter, setReceivesNewsletter] = useState<boolean>(true);
  const [firstName, setFirstName] = useState<string>("");
  const [lastName, setLastName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [address, setAddress] = useState<string>("");

  // Client profile fields
  const [cpNumChildren, setCpNumChildren] = useState<string>("");
  const [cpSpouseName, setCpSpouseName] = useState<string>("");
  const [cpSpouseBirthdate, setCpSpouseBirthdate] = useState<Date | undefined>(undefined);
  const [cpRetirementDate, setCpRetirementDate] = useState<Date | undefined>(undefined);
  const [cpNetWorth, setCpNetWorth] = useState<string>("");
  const [cpPrimaryConcern, setCpPrimaryConcern] = useState<string>("");
  const [cpAdditionalNotes, setCpAdditionalNotes] = useState<string>("");
  const [cpSeminarLocation, setCpSeminarLocation] = useState<string>("");

  // Follow-up fields
  const [fuDate, setFuDate] = useState<string>(""); // datetime-local
  const [fuType, setFuType] = useState<string>("");
  const [fuNotes, setFuNotes] = useState<string>("");
  const [fuMessage, setFuMessage] = useState<string>("");
  const [fuStatus, setFuStatus] = useState<string>("Pending");
  const [fuAutoSend, setFuAutoSend] = useState<boolean>(false);
  const [fuSentAt, setFuSentAt] = useState<string | null>(null);

  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);

  const loadDocs = async () => {
    if (!id) return;
    const headers = await staffAuthHeaders();
    if (!headers) return;
    const { data, error } = await cloudSupabase.functions.invoke("lead-documents", {
      headers,
      body: { leadId: id },
    });
    if (error || (data as any)?.error) toast.error(error?.message || (data as any).error);
    else setDocs(((data as any)?.documents ?? []) as LeadDocument[]);
  };

  const loadActivity = async () => {
    if (!id) return;
    const { data, error } = await cloudSupabase
      .from("contact_activity" as any)
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error) setActivity((data ?? []) as any[]);
  };

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("leadjig_leads")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) toast.error(error.message);
      if (data) {
        const l = data as Lead;
        setLead(l);
        setStatus(stageToLabel(effectiveLifecycleStage(l)));
        setAppointment(toLocalInput(l.appointment_at));
        setNotes(l.notes ?? "");
        setBirthdate(l.date_of_birth ? parseISO(l.date_of_birth) : undefined);
        setReceivesNewsletter(!l.do_not_email);
        const rp = (l.raw_payload ?? {}) as Record<string, any>;
        setFirstName(rp.first_name || (l.name ? String(l.name).split(" ")[0] : "") || "");
        setLastName(rp.last_name || (l.name ? String(l.name).split(" ").slice(1).join(" ") : "") || "");
        setEmail(l.email ?? "");
        setPhone(l.phone ?? "");
        setAddress(l.address ?? "");
        const cp = (l.client_profile ?? {}) as Record<string, any>;
        setCpNumChildren(cp.num_children != null ? String(cp.num_children) : "");
        setCpSpouseName(cp.spouse_name ?? "");
        setCpSpouseBirthdate(cp.spouse_birthdate ? parseISO(cp.spouse_birthdate) : undefined);
        setCpRetirementDate(cp.retirement_date ? parseISO(cp.retirement_date) : undefined);
        setCpNetWorth(cp.net_worth ?? "");
        setCpPrimaryConcern(cp.primary_concern ?? "");
        setCpAdditionalNotes(cp.additional_notes ?? "");
        setCpSeminarLocation(cp.seminar_location ?? "");
        setFuDate(cp.followup_date ? toLocalInput(cp.followup_date) : "");
        setFuType(cp.followup_type ?? "");
        setFuNotes(cp.followup_notes ?? "");
        setFuMessage(cp.followup_message ?? "");
        setFuStatus(cp.followup_status ?? "Pending");
        setFuAutoSend(!!cp.followup_auto_send);
        setFuSentAt(cp.followup_sent_at ?? null);
      }
      await Promise.all([loadDocs(), loadActivity()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onSave = async () => {
    if (!id) return;
    setSaving(true);
    const fn = firstName.trim();
    const ln = lastName.trim();
    const combinedName = [fn, ln].filter(Boolean).join(" ") || null;
    const mergedRaw = {
      ...((lead?.raw_payload ?? {}) as Record<string, any>),
      first_name: fn || null,
      last_name: ln || null,
    };
    let newStage = status ? labelToStage(status) : null;
    if (lead && isAttendedLead(lead) && newStage === "new") newStage = "hot_lead";
    const prevStage = lead?.lifecycle_stage ?? null;
    const stageChanged = newStage !== prevStage;
    const payload = {
      lifecycle_stage: newStage,
      appointment_at: appointment ? new Date(appointment).toISOString() : null,
      notes: notes || null,
      date_of_birth: birthdate ? format(birthdate, "yyyy-MM-dd") : null,
      do_not_email: !receivesNewsletter,
      name: combinedName,
      email: email.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      raw_payload: mergedRaw,
      client_profile: {
        num_children: cpNumChildren !== "" ? Number(cpNumChildren) : null,
        spouse_name: cpSpouseName.trim() || null,
        spouse_birthdate: cpSpouseBirthdate ? format(cpSpouseBirthdate, "yyyy-MM-dd") : null,
        retirement_date: cpRetirementDate ? format(cpRetirementDate, "yyyy-MM-dd") : null,
        net_worth: cpNetWorth || null,
        primary_concern: cpPrimaryConcern || null,
        additional_notes: cpAdditionalNotes || null,
        seminar_location: cpSeminarLocation.trim() || null,
        followup_date: fuDate ? new Date(fuDate).toISOString() : null,
        followup_type: fuType || null,
        followup_notes: fuNotes || null,
        followup_message: fuMessage || null,
        followup_status: fuStatus || null,
        followup_auto_send: fuAutoSend,
        followup_sent_at: fuSentAt,
      },
    };
    const { data, error } = await supabase
      .from("leadjig_leads")
      .update(payload)
      .eq("id", id)
      .select()
      .maybeSingle();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data) setLead(data as Lead);
    if (stageChanged) {
      const { data: { user } } = await cloudSupabase.auth.getUser();
      await cloudSupabase.from("contact_activity" as any).insert({
        lead_id: id,
        type: "status_change",
        channel: "status",
        body: `${stageToLabel(prevStage)} → ${stageToLabel(newStage)}`,
        status: "ok",
        created_by: user?.id ?? null,
      });
      await loadActivity();
    }
    toast.success("Contact saved");
  };

  const logActivity = async (entry: { channel: string; recipient: string; body: string; status: string; error?: string }) => {
    if (!id) return;
    const { data: { user } } = await cloudSupabase.auth.getUser();
    await cloudSupabase.from("contact_activity" as any).insert({
      lead_id: id,
      type: "manual_send",
      channel: entry.channel,
      recipient: entry.recipient,
      body: entry.body,
      status: entry.status,
      error: entry.error ?? null,
      created_by: user?.id ?? null,
    });
    await loadActivity();
  };

  const staffAuthHeaders = async (): Promise<Record<string, string> | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      toast.error("Not signed in");
      return null;
    }
    return { Authorization: `Bearer ${session.access_token}` };
  };

  const onSendEmail = async () => {
    if (!id) return;
    if (!email.trim()) {
      toast.error("This contact has no email address");
      return;
    }
    setSendingEmail(true);
    try {
      const headers = await staffAuthHeaders();
      if (!headers) return;
      const { data, error } = await cloudSupabase.functions.invoke("send-followup-email", {
        body: { leadId: id },
        headers,
      });
      if (error) throw error;
      if (data && (data as any).success === false) throw new Error((data as any).error || "Send failed");
      toast.success("Follow-up email sent");
      await logActivity({ channel: "email", recipient: email.trim(), body: "(default follow-up email)", status: "sent" });
    } catch (e: any) {
      toast.error(e?.message || "Failed to send email");
      await logActivity({ channel: "email", recipient: email.trim(), body: "", status: "error", error: e?.message });
    } finally {
      setSendingEmail(false);
    }
  };

  const onSendSms = async () => {
    if (!id) return;
    if (!phone.trim()) {
      toast.error("This contact has no phone number");
      return;
    }
    setSendingSms(true);
    try {
      const headers = await staffAuthHeaders();
      if (!headers) return;
      const { data, error } = await cloudSupabase.functions.invoke("send-followup-sms", {
        body: { leadId: id },
        headers,
      });
      if (error) throw error;
      if (data && (data as any).success === false) throw new Error((data as any).error || "Send failed");
      toast.success("Follow-up SMS sent");
      await logActivity({ channel: "sms", recipient: phone.trim(), body: "(default follow-up SMS)", status: "sent" });
    } catch (e: any) {
      toast.error(e?.message || "Failed to send SMS");
      await logActivity({ channel: "sms", recipient: phone.trim(), body: "", status: "error", error: e?.message });
    } finally {
      setSendingSms(false);
    }
  };

  const onUpload = async (file: File) => {
    if (!id) return;
    setUploading(true);
    try {
      const headers = await staffAuthHeaders();
      if (!headers) return;
      const form = new FormData();
      form.append("leadId", id);
      form.append("file", file, file.name);
      const { data, error } = await cloudSupabase.functions.invoke("lead-documents", {
        body: form,
        headers,
      });
      if (error || (data as any)?.error) throw new Error(error?.message || (data as any).error);
      toast.success("File uploaded");
      await loadDocs();
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const parseIsoDate = (v: unknown): Date | undefined => {
    if (!v || typeof v !== "string") return undefined;
    const d = parseISO(v);
    return isNaN(d.getTime()) ? undefined : d;
  };

  const onImportQuestionnaire = async (file: File) => {
    if (!id) return;
    setImporting(true);
    try {
      const headers = await staffAuthHeaders();
      if (!headers) return;
      const form = new FormData();
      form.append("file", file, file.name);
      const { data, error } = await cloudSupabase.functions.invoke("extract-questionnaire", {
        body: form,
        headers,
      });
      if (error || (data as any)?.error) throw new Error(error?.message || (data as any).error);
      const f = ((data as any)?.fields ?? {}) as Record<string, any>;

      let filled = 0;
      const fill = (cur: string, val: unknown, set: (v: string) => void) => {
        if (cur.trim()) return;
        const s = val == null ? "" : String(val).trim();
        if (!s) return;
        set(s);
        filled++;
      };
      const fillDate = (cur: Date | undefined, val: unknown, set: (d: Date | undefined) => void) => {
        if (cur) return;
        const d = parseIsoDate(val);
        if (!d) return;
        set(d);
        filled++;
      };

      fill(firstName, f.first_name, setFirstName);
      fill(lastName, f.last_name, setLastName);
      fill(email, f.email, setEmail);
      fill(phone, f.phone, setPhone);
      fill(address, f.address, setAddress);
      fillDate(birthdate, f.date_of_birth, setBirthdate);
      fill(cpSpouseName, f.spouse_name, setCpSpouseName);
      fillDate(cpSpouseBirthdate, f.spouse_birthdate, setCpSpouseBirthdate);
      fillDate(cpRetirementDate, f.retirement_date, setCpRetirementDate);
      if (!cpNumChildren && f.num_children != null) {
        setCpNumChildren(String(f.num_children));
        filled++;
      }
      fill(cpNetWorth, f.net_worth, setCpNetWorth);
      fill(cpPrimaryConcern, f.primary_concern, setCpPrimaryConcern);
      fill(cpSeminarLocation, f.seminar_location, setCpSeminarLocation);
      if (f.additional_notes) {
        const extra = String(f.additional_notes).trim();
        if (extra) {
          setCpAdditionalNotes((prev) => (prev.trim() ? `${prev}\n\n${extra}` : extra));
          filled++;
        }
      }

      // Also save the original file to documents
      await onUpload(file);

      toast.success(`Imported ${filled} field${filled === 1 ? "" : "s"} from questionnaire. Review and Save.`);
    } catch (e: any) {
      toast.error(e?.message || "Could not read questionnaire");
    } finally {
      setImporting(false);
    }
  };



  const onDownload = async (doc: LeadDocument) => {
    const headers = await staffAuthHeaders();
    if (!headers) return;
    const { data, error } = await cloudSupabase.functions.invoke("lead-documents", {
      body: { action: "signed-url", id: doc.id },
      headers,
    });
    const signedUrl = (data as any)?.signedUrl;
    if (error || !signedUrl) {
      toast.error(error?.message || (data as any)?.error || "Could not get download URL");
      return;
    }
    window.open(signedUrl, "_blank", "noopener");
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!lead) {
    return (
      <div className="text-center py-24">
        <p className="text-muted-foreground mb-4">Contact not found</p>
        <Link to="/"><Button variant="outline">Back to contacts</Button></Link>
      </div>
    );
  }

  const rp = (lead.raw_payload ?? {}) as Record<string, any>;
  const roleValue = (() => {
    const candidates = [lead.role, rp.role];
    for (const c of candidates) {
      if (c && String(c).trim().toLowerCase() !== "role") return String(c);
    }
    return null;
  })();
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || lead.name || "Unnamed contact";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{fullName}</h1>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={stageToLabel(effectiveLifecycleStage(lead))} />
              {lead.event_name && <span className="text-sm text-muted-foreground">· {lead.event_name}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={onSendEmail} disabled={sendingEmail || !email.trim()}>
            {sendingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Send Follow-up Email
          </Button>
          <Button variant="outline" onClick={onSendSms} disabled={sendingSms || !phone.trim()}>
            {sendingSms ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
            Send SMS
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Contact details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="first_name">First name</Label>
              <Input id="first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name">Last name</Label>
              <Input id="last_name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="birthdate">Birthdate</Label>
              <DateInput
                id="birthdate"
                value={birthdate}
                onChange={setBirthdate}
                disableFuture
                fromYear={1900}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp_spouse">Spouse / partner name</Label>
              <Input
                id="cp_spouse"
                value={cpSpouseName}
                onChange={(e) => setCpSpouseName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp_spouse_bd">Spouse birthdate</Label>
              <DateInput
                id="cp_spouse_bd"
                value={cpSpouseBirthdate}
                onChange={setCpSpouseBirthdate}
                disableFuture
                fromYear={1900}
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <ReadOnly label="Event name" value={lead.event_name} />
            <div className="space-y-1.5">
              <Label htmlFor="seminar_location">Seminar Location</Label>
              <Input
                id="seminar_location"
                value={cpSeminarLocation}
                onChange={(e) => setCpSeminarLocation(e.target.value)}
                placeholder="e.g. Queen Creek Library"
              />
            </div>
            <ReadOnly
              label="Seminar Date"
              value={(() => {
                if (!lead.event_date) return null;
                const d = new Date(lead.event_date);
                return isNaN(d.getTime()) ? lead.event_date : format(d, "MMMM d, yyyy");
              })()}
            />
            <ReadOnly
              label="Appointment"
              value={(() => {
                const appt = lead.appointment_at;
                if (!appt) return null;
                const d = new Date(appt);
                return isNaN(d.getTime()) ? null : format(d, "MMMM d, yyyy 'at' h:mm a");
              })()}
            />
            <ReadOnly label="Registration group ID" value={lead.registration_group_id ?? null} />
            <ReadOnly label="Role" value={roleValue} />
            <ReadOnly label="Is guest" value={lead.is_guest == null ? null : lead.is_guest ? "Yes" : "No"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Status & follow-up</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appt">Appointment</Label>
              <Input
                id="appt"
                type="datetime-local"
                value={appointment}
                onChange={(e) => setAppointment(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="newsletter">Receives Newsletter</Label>
                <p className="text-xs text-muted-foreground">Turn off to opt out of email.</p>
              </div>
              <Switch
                id="newsletter"
                checked={receivesNewsletter}
                onCheckedChange={setReceivesNewsletter}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Follow-up</CardTitle>
            <Button size="sm" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save follow-up
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fu_date">Follow-up date</Label>
              <Input
                id="fu_date"
                type="datetime-local"
                value={fuDate}
                onChange={(e) => setFuDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Follow-up type</Label>
              <Select value={fuType} onValueChange={setFuType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {["Call", "Email", "SMS", "In Person"].map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Follow-up status</Label>
              <Select value={fuStatus} onValueChange={setFuStatus}>
                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  {["Pending", "Completed", "Cancelled"].map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="fu_notes">Follow-up notes (internal only)</Label>
              <Textarea
                id="fu_notes"
                rows={4}
                value={fuNotes}
                onChange={(e) => setFuNotes(e.target.value)}
                placeholder="Internal memo — not sent to the client."
              />
              <p className="text-xs text-muted-foreground">Visible only to admins. Never sent to the contact.</p>
            </div>
            {(fuType === "SMS" || fuType === "Email") && (
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="fu_message">
                  {fuType === "SMS" ? "SMS Message" : "Email Message"} (sent to client)
                </Label>
                <Textarea
                  id="fu_message"
                  rows={4}
                  value={fuMessage}
                  onChange={(e) => setFuMessage(e.target.value)}
                  placeholder={
                    fuType === "SMS"
                      ? "The exact SMS body that will be sent to the contact when auto-send fires."
                      : "The exact email body that will be sent to the contact when auto-send fires."
                  }
                />
                <p className="text-xs text-muted-foreground">
                  This is the message the contact receives via {fuType === "SMS" ? "Twilio SMS" : "email"}.
                </p>
              </div>
            )}
            <div className="sm:col-span-2 flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="fu_auto">Auto-send when due</Label>
                <p className="text-xs text-muted-foreground">
                  When on, the system will automatically send the Email or SMS at the follow-up date.
                  Call / In-Person types stay manual.
                  {fuSentAt && (
                    <span className="block mt-1 text-emerald-600">
                      Last auto-sent: {new Date(fuSentAt).toLocaleString()}
                    </span>
                  )}
                </p>
              </div>
              <Switch
                id="fu_auto"
                checked={fuAutoSend}
                onCheckedChange={(v) => {
                  setFuAutoSend(v);
                  if (v) setFuSentAt(null); // re-arm when toggled on
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader><CardTitle className="text-base">Client Profile</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp_children">Number of children</Label>
              <Input
                id="cp_children"
                type="number"
                min={0}
                value={cpNumChildren}
                onChange={(e) => setCpNumChildren(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp_retire">Retirement date</Label>
              <DateInput
                id="cp_retire"
                value={cpRetirementDate}
                onChange={setCpRetirementDate}
                fromYear={1950}
                toYear={2100}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Estimated net worth</Label>
              <Select value={cpNetWorth} onValueChange={setCpNetWorth}>
                <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
                <SelectContent>
                  {NET_WORTH_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Primary concern</Label>
              <Select value={cpPrimaryConcern} onValueChange={setCpPrimaryConcern}>
                <SelectTrigger><SelectValue placeholder="Select concern" /></SelectTrigger>
                <SelectContent>
                  {PRIMARY_CONCERN_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="cp_notes">Additional notes</Label>
              <Textarea
                id="cp_notes"
                rows={5}
                value={cpAdditionalNotes}
                onChange={(e) => setCpAdditionalNotes(e.target.value)}
                placeholder="Anything else worth remembering…"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={8}
              placeholder="Add notes about this contact…"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Documents</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload
            </Button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
            />
          </CardHeader>
          <CardContent>
            {docs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No files yet</p>
            ) : (
              <ul className="divide-y">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2 gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(d.uploaded_at).toLocaleString()}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => onDownload(d)}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader><CardTitle className="text-base">Activity history</CardTitle></CardHeader>
          <CardContent>
            {(() => {
              const regRaw = (lead.raw_payload as any)?.registration_date || lead.created_at;
              const regDate = regRaw ? new Date(regRaw) : null;
              const items: any[] = [...activity];
              if (regDate && !isNaN(regDate.getTime())) {
                items.push({
                  id: "__registered__",
                  type: "registered",
                  channel: "status",
                  status: "ok",
                  body: "Registered",
                  created_at: regDate.toISOString(),
                });
              }
              items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
              if (items.length === 0) {
                return <p className="text-sm text-muted-foreground py-4 text-center">No activity yet</p>;
              }
              return (
                <ul className="divide-y">
                  {items.map((a) => {
                    const isStatus = a.type === "status_change" || a.type === "registered";
                    return (
                      <li key={a.id} className="py-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-sm font-medium">
                            {isStatus
                              ? (a.type === "registered" ? "Registered" : "Status changed")
                              : (a.channel === "sms" ? "SMS" : a.channel === "email" ? "Email" : a.channel)}
                            {!isStatus && (
                              <>
                                {" · "}
                                <span className={a.status === "error" ? "text-destructive" : "text-emerald-600"}>
                                  {a.status}
                                </span>
                              </>
                            )}
                            {a.type === "followup_auto_send" && (
                              <span className="ml-2 text-xs text-muted-foreground">(auto-send)</span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(a.created_at).toLocaleString()}
                          </span>
                        </div>
                        {a.recipient && (
                          <p className="text-xs text-muted-foreground mt-1">To: {a.recipient}</p>
                        )}
                        {a.body && (
                          <p className="text-sm mt-1 whitespace-pre-wrap">{a.body}</p>
                        )}
                        {a.error && (
                          <p className="text-xs text-destructive mt-1">{a.error}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
