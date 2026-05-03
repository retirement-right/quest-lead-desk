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
  | "Prospect"
  | "Client"
  | "Not Interested"
  | "Appointment Set";

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
  "Prospect",
  "Appointment Set",
  "Client",
  "Not Interested",
];

const DB_TO_LABEL: Record<string, LeadStatus> = {
  new: "Prospect",
  prospect: "Prospect",
  consultation_booked: "Appointment Set",
  appointment_set: "Appointment Set",
  client: "Client",
  lost: "Not Interested",
  not_interested: "Not Interested",
};

const LABEL_TO_DB: Record<LeadStatus, string> = {
  Prospect: "new",
  "Appointment Set": "consultation_booked",
  Client: "client",
  "Not Interested": "lost",
};

export const stageToLabel = (stage?: string | null): LeadStatus => {
  if (!stage) return "Prospect";
  return DB_TO_LABEL[stage.toLowerCase()] ?? "Prospect";
};

export const labelToStage = (label: string): string => LABEL_TO_DB[label as LeadStatus] ?? label;
