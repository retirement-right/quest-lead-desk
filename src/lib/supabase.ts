import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://uoneplysuvmaygbrbswd.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvbmVwbHlzdXZtYXlnYnJic3dkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDgwNTgsImV4cCI6MjA4NzUyNDA1OH0.XORQ3mc7MIjaZzof4t3g11nXgtVuh45FRFTKasTJtt8";

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
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  event_name: string | null;
  event_date: string | null;
  status: LeadStatus | string | null;
  appointment_at: string | null;
  notes: string | null;
  updated_at: string | null;
  registration_group_id?: string | null;
  is_guest?: boolean | null;
  role?: string | null;
}

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
