DROP POLICY IF EXISTS "Anyone can view birthday outreach log" ON public.birthday_outreach_log;
CREATE POLICY "Authenticated users can view birthday outreach log"
ON public.birthday_outreach_log
FOR SELECT
TO authenticated
USING (true);