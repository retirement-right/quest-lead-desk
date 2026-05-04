-- Log table for raw BookedIN appointment events written by Zapier (via edge function)
CREATE TABLE public.bookedin_appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_email TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  appointment_date TIMESTAMP WITH TIME ZONE,
  appointment_status TEXT NOT NULL CHECK (appointment_status IN ('booked','rescheduled','cancelled')),
  notes TEXT,
  raw_payload JSONB,
  processed_at TIMESTAMP WITH TIME ZONE,
  process_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookedin_appointments_email ON public.bookedin_appointments (lower(contact_email));
CREATE INDEX idx_bookedin_appointments_created_at ON public.bookedin_appointments (created_at DESC);

ALTER TABLE public.bookedin_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bookedin appointments"
  ON public.bookedin_appointments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can insert bookedin appointments"
  ON public.bookedin_appointments FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role can update bookedin appointments"
  ON public.bookedin_appointments FOR UPDATE TO service_role USING (true);