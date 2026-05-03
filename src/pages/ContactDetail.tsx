import { useEffect, useState, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { supabase, Lead, LeadDocument, STATUS_OPTIONS, stageToLabel, labelToStage } from "@/lib/supabase";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ArrowLeft, CalendarIcon, Download, Loader2, Save, Upload } from "lucide-react";
import { toast } from "sonner";

const BUCKET = "lead-documents";

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

  const [lead, setLead] = useState<Lead | null>(null);
  const [docs, setDocs] = useState<LeadDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  const loadDocs = async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from("lead_documents")
      .select("*")
      .eq("lead_id", id)
      .order("uploaded_at", { ascending: false });
    if (error) toast.error(error.message);
    else setDocs((data ?? []) as LeadDocument[]);
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
        setStatus(stageToLabel(l.lifecycle_stage));
        setAppointment(toLocalInput(l.appointment_at));
        setNotes(l.notes ?? "");
        setBirthdate(l.date_of_birth ? parseISO(l.date_of_birth) : undefined);
        setReceivesNewsletter(!l.do_not_email);
        const rp = (l.raw_payload ?? {}) as Record<string, any>;
        setFirstName(l.first_name || rp.first_name || (l.name ? String(l.name).split(" ")[0] : "") || "");
        setLastName(l.last_name || rp.last_name || (l.name ? String(l.name).split(" ").slice(1).join(" ") : "") || "");
        setEmail(l.email ?? "");
        setPhone(l.phone ?? "");
        setAddress(l.address ?? "");
      }
      await loadDocs();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onSave = async () => {
    if (!id) return;
    setSaving(true);
    const payload = {
      lifecycle_stage: status ? labelToStage(status) : null,
      appointment_at: appointment ? new Date(appointment).toISOString() : null,
      notes: notes || null,
      date_of_birth: birthdate ? format(birthdate, "yyyy-MM-dd") : null,
      do_not_email: !receivesNewsletter,
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
    toast.success("Contact saved");
  };

  const onUpload = async (file: File) => {
    if (!id) return;
    setUploading(true);
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${id}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
    if (upErr) {
      setUploading(false);
      toast.error(upErr.message);
      return;
    }
    const { error: insErr } = await supabase.from("lead_documents").insert({
      lead_id: id,
      file_name: file.name,
      file_path: path,
    });
    setUploading(false);
    if (insErr) {
      toast.error(insErr.message);
      return;
    }
    toast.success("File uploaded");
    await loadDocs();
  };

  const onDownload = async (doc: LeadDocument) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.file_path, 60);
    if (error || !data) {
      toast.error(error?.message || "Could not get download URL");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
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
  const firstName = lead.first_name || rp.first_name || (lead.name ? String(lead.name).split(" ")[0] : "") || "";
  const lastName = lead.last_name || rp.last_name || (lead.name ? String(lead.name).split(" ").slice(1).join(" ") : "") || "";
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
              <StatusBadge status={stageToLabel(lead.lifecycle_stage)} />
              {lead.event_name && <span className="text-sm text-muted-foreground">· {lead.event_name}</span>}
            </div>
          </div>
        </div>
        <Button onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Contact details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <ReadOnly label="First name" value={firstName} />
            <ReadOnly label="Last name" value={lastName} />
            <ReadOnly label="Email" value={lead.email} />
            <ReadOnly label="Phone" value={lead.phone} />
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Birthdate</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !birthdate && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {birthdate ? format(birthdate, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={birthdate}
                    onSelect={setBirthdate}
                    captionLayout="dropdown-buttons"
                    fromYear={1900}
                    toYear={new Date().getFullYear()}
                    disabled={(d) => d > new Date() || d < new Date("1900-01-01")}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="sm:col-span-2"><ReadOnly label="Address" value={lead.address} /></div>
            <ReadOnly label="Event name" value={lead.event_name} />
            <ReadOnly label="Event date" value={lead.event_date} />
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
      </div>
    </div>
  );
}
