ALTER TABLE "coffee_meetups"
  ADD COLUMN IF NOT EXISTS "external_place_name" TEXT,
  ADD COLUMN IF NOT EXISTS "external_google_maps_url" TEXT;

ALTER TABLE "coffee_meetups"
  ALTER COLUMN "cafe_id" DROP NOT NULL;

ALTER TABLE "coffee_meetups"
  DROP CONSTRAINT IF EXISTS "coffee_meetups_place_check";

ALTER TABLE "coffee_meetups"
  ADD CONSTRAINT "coffee_meetups_place_check" CHECK (
    (CASE WHEN "cafe_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "external_place_name" IS NOT NULL AND "external_google_maps_url" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

ALTER TABLE "coffee_meetups"
  DROP CONSTRAINT IF EXISTS "coffee_meetups_google_maps_url_check";

ALTER TABLE "coffee_meetups"
  ADD CONSTRAINT "coffee_meetups_google_maps_url_check" CHECK (
    "external_google_maps_url" IS NULL OR
    "external_google_maps_url" ~ '^https://(maps\.app\.goo\.gl/[^[:space:]]+|goo\.gl/maps/[^[:space:]]+|(www\.)?google\.com/maps[^[:space:]]*)$'
  );
