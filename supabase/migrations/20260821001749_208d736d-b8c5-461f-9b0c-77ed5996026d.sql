UPDATE public.bookedin_appointments
SET notes = COALESCE(NULLIF(notes, ''), '') ||
            CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END ||
            '[resolved] cleanup ' || now()::text || ' — was: ' || process_error,
    process_error = NULL
WHERE process_error IS NOT NULL
  AND (process_error ILIKE '%cancelled event with no contact name%'
       OR process_error ILIKE '%cancelled with no email/name%');