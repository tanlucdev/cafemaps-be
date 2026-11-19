ALTER TABLE public.cafes
  ADD COLUMN IF NOT EXISTS image_source_usernames text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_cafes_image_source_usernames
  ON public.cafes USING GIN (image_source_usernames);

COMMENT ON COLUMN public.cafes.image_source_usernames IS
  'Instagram accounts supplying images in this cafe gallery. Cafe-level provenance, not per-image authorship.';
