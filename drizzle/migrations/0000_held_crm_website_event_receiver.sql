CREATE TABLE public.crm_website_events (
 event_key text PRIMARY KEY,
 delivery_id uuid NOT NULL,
 event_type text NOT NULL CHECK (event_type IN ('checkin','unsubscribe')),
 email text NOT NULL,
 payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'held' CHECK (status = 'held'),
 received_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.crm_website_events TO service_role;
REVOKE ALL ON public.crm_website_events FROM anon, authenticated;
ALTER TABLE public.crm_website_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service only event inbox" ON public.crm_website_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TABLE public.crm_email_suppressions (
 email text PRIMARY KEY,
 first_event_key text NOT NULL REFERENCES public.crm_website_events(event_key),
 suppressed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.crm_email_suppressions TO service_role;
REVOKE ALL ON public.crm_email_suppressions FROM anon, authenticated;
ALTER TABLE public.crm_email_suppressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service only email suppression" ON public.crm_email_suppressions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE FUNCTION public.accept_website_event(_event_key text, _delivery_id uuid, _event_type text, _email text, _payload jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing public.crm_website_events%ROWTYPE; inserted integer;
BEGIN
 IF _event_key IS NULL OR length(_event_key) NOT BETWEEN 1 AND 512 OR _delivery_id IS NULL OR _event_type IS NULL OR _event_type NOT IN ('checkin','unsubscribe') OR _email IS NULL OR _email <> lower(trim(_email)) OR length(_email) > 254 OR _email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR _payload IS NULL OR jsonb_typeof(_payload) <> 'object' OR octet_length(_payload::text) > 16384 OR (_payload->>'email') IS DISTINCT FROM _email OR (_payload->>'source') IS DISTINCT FROM (CASE WHEN _event_type='unsubscribe' THEN 'retirement_right_local_unsubscribe' ELSE 'retirement_right_admin_checkin' END) THEN
  RAISE EXCEPTION 'Invalid website event';
 END IF;
 INSERT INTO public.crm_website_events(event_key,delivery_id,event_type,email,payload) VALUES(_event_key,_delivery_id,_event_type,_email,_payload) ON CONFLICT(event_key) DO NOTHING;
 GET DIAGNOSTICS inserted = ROW_COUNT;
 IF inserted = 0 THEN
  SELECT * INTO existing FROM public.crm_website_events WHERE event_key=_event_key;
  IF existing.event_type IS DISTINCT FROM _event_type OR existing.email IS DISTINCT FROM _email OR existing.payload IS DISTINCT FROM _payload THEN RETURN 'conflict'; END IF;
 END IF;
 IF _event_type='unsubscribe' THEN
  INSERT INTO public.crm_email_suppressions(email,first_event_key) VALUES(_email,_event_key) ON CONFLICT(email) DO NOTHING;
 END IF;
 IF inserted=0 THEN RETURN 'duplicate'; END IF;
 RETURN 'accepted';
END $$;
REVOKE ALL ON FUNCTION public.accept_website_event(text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_website_event(text,uuid,text,text,jsonb) TO service_role;
COMMENT ON TABLE public.crm_website_events IS 'Held receive-only website events. No contact mutation, follow-up enrollment, send trigger, or historical import.';
COMMENT ON TABLE public.crm_email_suppressions IS 'Sticky all-CRM-marketing-email suppression from website group or newsletter opt-outs. Check-ins never restore consent.';