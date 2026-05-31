CREATE TABLE public.birthday_outreach_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id text NOT NULL,
  contact_name text,
  recipient text,
  outreach_type text NOT NULL CHECK (outreach_type IN ('email','sms')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by text,
  year_sent integer NOT NULL,
  person_kind text NOT NULL DEFAULT 'primary' CHECK (person_kind IN ('primary','spouse'))
);

CREATE INDEX idx_birthday_outreach_lookup
  ON public.birthday_outreach_log (contact_id, person_kind, outreach_type, year_sent);

CREATE INDEX idx_birthday_outreach_sent_at
  ON public.birthday_outreach_log (sent_at DESC);

GRANT SELECT, INSERT ON public.birthday_outreach_log TO authenticated;
GRANT SELECT ON public.birthday_outreach_log TO anon;
GRANT ALL ON public.birthday_outreach_log TO service_role;

ALTER TABLE public.birthday_outreach_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view birthday outreach log"
  ON public.birthday_outreach_log FOR SELECT
  USING (true);

CREATE POLICY "Service role inserts birthday outreach"
  ON public.birthday_outreach_log FOR INSERT
  TO service_role
  WITH CHECK (true);