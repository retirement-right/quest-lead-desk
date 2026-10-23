-- STAGED ONLY. Not a migration. Apply via the migration tool only AFTER
-- owner Website-session verification, all privileged handlers enforce that
-- same protected role, and owner read-only compatibility checks pass.
-- Cloud does not share Website auth identities: direct browser access is denied.
BEGIN;
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
COMMIT;
-- Existing RLS, service-role policies/privileges, rows, buckets and schedules
-- remain unchanged. Recheck sibling/inherited policies and grants immediately
-- before application; prepare an owner-access rollback from then-current state.