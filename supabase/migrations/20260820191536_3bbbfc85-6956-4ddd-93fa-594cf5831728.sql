CREATE TABLE IF NOT EXISTS public.internal_secrets (
  name text PRIMARY KEY,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.internal_secrets TO service_role;

ALTER TABLE public.internal_secrets ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated on purpose: this table is service-role only.

INSERT INTO public.internal_secrets (name, secret)
VALUES ('process_followups', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (name) DO NOTHING;