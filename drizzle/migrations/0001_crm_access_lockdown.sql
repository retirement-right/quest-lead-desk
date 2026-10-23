REVOKE ALL PRIVILEGES ON TABLE
  public.birthday_outreach_log,
  public.bookedin_appointments,
  public.contact_activity,
  public.inbound_sms_unmatched,
  public.lead_documents,
  public.internal_secrets
FROM anon, authenticated;

DROP POLICY "Authenticated users can view birthday outreach log" ON public.birthday_outreach_log;
DROP POLICY "Authenticated users can view bookedin appointments" ON public.bookedin_appointments;
DROP POLICY "Authenticated users can insert activity" ON public.contact_activity;
DROP POLICY "Authenticated users can view activity" ON public.contact_activity;
DROP POLICY "Authenticated users can update unmatched inbound" ON public.inbound_sms_unmatched;
DROP POLICY "Authenticated users can view unmatched inbound" ON public.inbound_sms_unmatched;
DROP POLICY "Authenticated users can delete lead documents" ON public.lead_documents;
DROP POLICY "Authenticated users can insert lead documents" ON public.lead_documents;
DROP POLICY "Authenticated users can view lead documents" ON public.lead_documents;

DROP POLICY "Authenticated can read lead documents" ON storage.objects;
DROP POLICY "Authenticated can upload lead documents" ON storage.objects;
DROP POLICY "Authenticated can delete lead documents" ON storage.objects;

GRANT ALL ON TABLE
  public.birthday_outreach_log,
  public.bookedin_appointments,
  public.contact_activity,
  public.inbound_sms_unmatched,
  public.lead_documents
TO service_role;