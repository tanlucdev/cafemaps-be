CREATE TABLE "donation_settings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "qr_image_url" TEXT,
  "title_vi" VARCHAR(120),
  "title_en" VARCHAR(120),
  "description_vi" VARCHAR(500),
  "description_en" VARCHAR(500),
  CONSTRAINT "donation_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "donation_settings_singleton" CHECK ("id" = 1)
);
