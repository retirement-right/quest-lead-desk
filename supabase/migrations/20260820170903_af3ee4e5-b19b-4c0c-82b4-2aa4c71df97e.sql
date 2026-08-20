ALTER TABLE public.contact_activity
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS sender TEXT,
  ADD COLUMN IF NOT EXISTS to_number TEXT,
  ADD COLUMN IF NOT EXISTS message_sid TEXT,
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS contact_activity_message_sid_key
  ON public.contact_activity(message_sid) WHERE message_sid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inbound_sms_unmatched (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_sid TEXT NOT NULL UNIQUE,
  from_number TEXT NOT NULL,
  to_number TEXT,
  body TEXT,
  num_media INTEGER NOT NULL DEFAULT 0,
  provider_status TEXT,
  metadata JSONB,
  resolved_lead_id UUID,
  resolved_at TIMESTAMP WITH TIME ZONE,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.inbound_sms_unmatched TO authenticated;
GRANT ALL ON public.inbound_sms_unmatched TO service_role;

ALTER TABLE public.inbound_sms_unmatched ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view unmatched inbound" ON public.inbound_sms_unmatched;
CREATE POLICY "Authenticated users can view unmatched inbound"
ON public.inbound_sms_unmatched FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can update unmatched inbound" ON public.inbound_sms_unmatched;
CREATE POLICY "Authenticated users can update unmatched inbound"
ON public.inbound_sms_unmatched FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage unmatched inbound" ON public.inbound_sms_unmatched;
CREATE POLICY "Service role can manage unmatched inbound"
ON public.inbound_sms_unmatched FOR ALL TO service_role USING (true) WITH CHECK (true);