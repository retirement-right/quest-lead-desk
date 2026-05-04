CREATE TABLE public.contact_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL,
  type TEXT NOT NULL,
  channel TEXT,
  recipient TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_activity_lead_id ON public.contact_activity(lead_id, created_at DESC);

ALTER TABLE public.contact_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view activity"
ON public.contact_activity FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert activity"
ON public.contact_activity FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Service role can insert activity"
ON public.contact_activity FOR INSERT TO service_role WITH CHECK (true);
