ALTER TABLE public.cafes
  ADD COLUMN IF NOT EXISTS experience_urls text[] NOT NULL DEFAULT '{}';
