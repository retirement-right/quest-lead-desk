CREATE OR REPLACE FUNCTION public.normalize_sms_phone(_phone text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = public AS $$
  SELECT CASE
    WHEN trim(_phone) ~ '^\+[0-9 () .-]+$' AND length(d) BETWEEN 10 AND 15 AND d ~ '^[1-9]' THEN '+' || d
    WHEN trim(_phone) ~ '^[0-9 () .-]+$' AND length(d)=10 THEN '+1' || d
    WHEN trim(_phone) ~ '^[0-9 () .-]+$' AND length(d)=11 AND d LIKE '1%' THEN '+' || d
    ELSE NULL END
  FROM (SELECT regexp_replace(_phone, '[^0-9]', '', 'g') AS d) normalized;
$$;
CREATE OR REPLACE FUNCTION public.sms_consent_keyword(_body text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = public AS $$
  SELECT CASE
    WHEN k IN ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT','STOP ALL','OPT OUT') THEN 'out'
    WHEN k IN ('START','UNSTOP','YES') THEN 'in'
    ELSE NULL END
  FROM (SELECT regexp_replace(regexp_replace(upper(trim(_body)), '[.![:space:]]+$', ''), '[[:space:]]+', ' ', 'g') AS k) normalized;
$$;
CREATE INDEX IF NOT EXISTS contact_activity_sms_consent_latest
ON public.contact_activity (public.normalize_sms_phone(sender), created_at DESC, (public.sms_consent_keyword(body)='out') DESC)
WHERE direction='inbound' AND public.sms_consent_keyword(body) IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbound_sms_unmatched_consent_latest
ON public.inbound_sms_unmatched (public.normalize_sms_phone(from_number), received_at DESC, (public.sms_consent_keyword(body)='out') DESC)
WHERE public.sms_consent_keyword(body) IS NOT NULL;
CREATE OR REPLACE FUNCTION public.sms_opt_out_status(_phone text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE phone text; decision text;
BEGIN
  phone := public.normalize_sms_phone(_phone);
  IF phone IS NULL THEN RAISE EXCEPTION 'Invalid SMS recipient'; END IF;
  SELECT k INTO decision FROM (
    (SELECT public.sms_consent_keyword(body) AS k, created_at AS at
     FROM public.contact_activity
     WHERE direction='inbound' AND public.normalize_sms_phone(sender)=phone
       AND public.sms_consent_keyword(body) IS NOT NULL
     ORDER BY created_at DESC, (public.sms_consent_keyword(body)='out') DESC LIMIT 1)
    UNION ALL
    (SELECT public.sms_consent_keyword(body) AS k, received_at AS at
     FROM public.inbound_sms_unmatched
     WHERE public.normalize_sms_phone(from_number)=phone AND public.sms_consent_keyword(body) IS NOT NULL
     ORDER BY received_at DESC, (public.sms_consent_keyword(body)='out') DESC LIMIT 1)
  ) latest ORDER BY at DESC, (k='out') DESC LIMIT 1;
  RETURN CASE WHEN decision='out' THEN 'opted_out' ELSE 'allowed' END;
END;
$$;
REVOKE ALL ON FUNCTION public.normalize_sms_phone(text), public.sms_consent_keyword(text), public.sms_opt_out_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_sms_phone(text), public.sms_consent_keyword(text), public.sms_opt_out_status(text) TO service_role;