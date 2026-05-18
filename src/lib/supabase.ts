import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8Vv7urmF3VqUXH3avaxrsg_cfSNKWr1";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: localStorage,
  },
});

export type LeadStatus =
  | "Hot Lead"
  | "Prospect"
  | "Client"
  | "Not Interested"
  | "Appointment Set"
  | "Cancelled";

export interface Lead {
  id: string;
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  phone: string | null;
  address: string | null;
  event_name: string | null;
  event_date: string | null;
  lifecycle_stage: string | null;
  attended_status?: string | null;
  appointment_at?: string | null;
  notes?: string | null;
  raw_payload?: Record<string, any> | null;
  updated_at?: string | null;
  created_at?: string | null;
  registration_group_id?: string | null;
  is_guest?: boolean | null;
  date_of_birth?: string | null;
  role?: string | null;
  do_not_email?: boolean | null;
  client_profile?: Record<string, any> | null;
}

export const NET_WORTH_OPTIONS = [
  "Under $250k",
  "$250k-$500k",
  "$500k-$1m",
  "$1m-$2m",
  "$2m+",
] as const;

export const PRIMARY_CONCERN_OPTIONS = [
  "Social Security",
  "RMDs",
  "Investment Risk",
  "Estate Planning",
  "Tax Strategy",
  "Other",
] as const;

export interface LeadDocument {
  id: string;
  lead_id: string;
  file_name: string;
  file_path: string;
  uploaded_at: string;
}

export const STATUS_OPTIONS: LeadStatus[] = [
  "Hot Lead",
  "Prospect",
  "Appointment Set",
  "Client",
  "Not Interested",
  "Cancelled",
];

const DB_TO_LABEL: Record<string, LeadStatus> = {
  hot_lead: "Hot Lead",
  warm_lead: "Prospect",
  cold_lead: "Prospect",
  new: "Prospect",
  prospect: "Prospect",
  consultation_booked: "Appointment Set",
  appointment_set: "Appointment Set",
  client: "Client",
  lost: "Not Interested",
  not_interested: "Not Interested",
  cancelled: "Cancelled",
};

const LABEL_TO_DB: Record<LeadStatus, string> = {
  "Hot Lead": "hot_lead",
  Prospect: "new",
  "Appointment Set": "consultation_booked",
  Client: "client",
  "Not Interested": "lost",
  Cancelled: "cancelled",
};

export const stageToLabel = (stage?: string | null): LeadStatus => {
  if (!stage) return "Prospect";
  return DB_TO_LABEL[stage.toLowerCase()] ?? "Prospect";
};

export const labelToStage = (label: string): string => LABEL_TO_DB[label as LeadStatus] ?? label;

export const isAttendedLead = (lead: Pick<Lead, "attended_status" | "raw_payload" | "client_profile">): boolean => {
  const sources = [lead, lead.raw_payload ?? {}, lead.client_profile ?? {}] as Record<string, any>[];
  const keys = ["attended_status", "attendance_status", "attended", "attendance", "checked_in", "check_in_status"];

  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (value == null || value === "") continue;
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value === 1;

      const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (["not_attended", "did_not_attend", "no_show", "noshow", "absent", "false", "no"].includes(normalized)) {
        return false;
      }
      if (["attended", "present", "checked_in", "check_in", "yes", "true", "1"].includes(normalized)) {
        return true;
      }
    }
  }

  return false;
};

export const effectiveLifecycleStage = (lead: Lead): string | null =>
  isAttendedLead(lead) ? "hot_lead" : lead.lifecycle_stage;
