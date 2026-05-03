-- Create lead_documents table on Lovable Cloud
CREATE TABLE public.lead_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_documents_lead_id ON public.lead_documents(lead_id);

ALTER TABLE public.lead_documents ENABLE ROW LEVEL SECURITY;

-- Any authenticated user (CRM staff) can manage documents
CREATE POLICY "Authenticated users can view lead documents"
  ON public.lead_documents FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert lead documents"
  ON public.lead_documents FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete lead documents"
  ON public.lead_documents FOR DELETE
  TO authenticated USING (true);

-- Create private storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('lead-documents', 'lead-documents', false);

-- Storage RLS: any authenticated user can read/write
CREATE POLICY "Authenticated can read lead documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'lead-documents');

CREATE POLICY "Authenticated can upload lead documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'lead-documents');

CREATE POLICY "Authenticated can delete lead documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'lead-documents');