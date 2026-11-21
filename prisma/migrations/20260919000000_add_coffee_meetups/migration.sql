DROP FUNCTION IF EXISTS public.coffee_meetup_accept_request(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.coffee_meetup_cancel(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.coffee_meetup_complete(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.coffee_meetup_create(text, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, integer) CASCADE;
DROP FUNCTION IF EXISTS public.coffee_meetup_join_request(uuid, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.coffee_meetup_reject_request(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.coffee_meetup_report(uuid, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.coffee_meetup_touch_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.coffee_meetup_update(uuid, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, integer) CASCADE;
DROP FUNCTION IF EXISTS public.coffee_meetup_withdraw_request(uuid, text) CASCADE;

CREATE TABLE IF NOT EXISTS "coffee_meetups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cafe_id" UUID NOT NULL,
  "organizer_id" UUID NOT NULL,
  "purpose" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "ends_at" TIMESTAMPTZ(6) NOT NULL,
  "max_participants" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "is_hidden" BOOLEAN NOT NULL DEFAULT false,
  "admin_note" TEXT,
  "hidden_at" TIMESTAMPTZ(6),
  "hidden_by_id" UUID,
  "cancelled_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coffee_meetups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "coffee_meetup_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "meetup_id" UUID NOT NULL,
  "requester_id" UUID NOT NULL,
  "message" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "accepted_at" TIMESTAMPTZ(6),
  "rejected_at" TIMESTAMPTZ(6),
  "withdrawn_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coffee_meetup_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "coffee_meetup_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "meetup_id" UUID NOT NULL,
  "reporter_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "resolved_at" TIMESTAMPTZ(6),
  "resolved_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coffee_meetup_reports_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_cafe_slug_fkey";
ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_cafe_id_fkey";
ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_organizer_id_fkey";
ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_hidden_by_id_fkey";
ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_time_check";
ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_capacity_check";
ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_status_check";
ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_check";
ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_check1";
ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_max_participants_check";
ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_accepted_count_check";
ALTER TABLE "coffee_meetups" DROP CONSTRAINT IF EXISTS "coffee_meetups_purpose_check";

ALTER TABLE "coffee_meetup_requests" DROP CONSTRAINT IF EXISTS "coffee_meetup_requests_meetup_id_fkey";
ALTER TABLE "coffee_meetup_requests" DROP CONSTRAINT IF EXISTS "coffee_meetup_requests_requester_id_fkey";
ALTER TABLE "coffee_meetup_requests" DROP CONSTRAINT IF EXISTS "coffee_meetup_requests_status_check";
ALTER TABLE "coffee_meetup_requests" DROP CONSTRAINT IF EXISTS "coffee_meetup_requests_meetup_id_requester_id_key";

ALTER TABLE "coffee_meetup_reports" DROP CONSTRAINT IF EXISTS "coffee_meetup_reports_meetup_id_fkey";
ALTER TABLE "coffee_meetup_reports" DROP CONSTRAINT IF EXISTS "coffee_meetup_reports_reporter_id_fkey";
ALTER TABLE "coffee_meetup_reports" DROP CONSTRAINT IF EXISTS "coffee_meetup_reports_resolved_by_id_fkey";
ALTER TABLE "coffee_meetup_reports" DROP CONSTRAINT IF EXISTS "coffee_meetup_reports_reason_check";
ALTER TABLE "coffee_meetup_reports" DROP CONSTRAINT IF EXISTS "coffee_meetup_reports_meetup_id_reporter_id_key";

ALTER TABLE "coffee_meetups" ADD COLUMN IF NOT EXISTS "is_hidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "coffee_meetups" ADD COLUMN IF NOT EXISTS "admin_note" TEXT;
ALTER TABLE "coffee_meetups" ADD COLUMN IF NOT EXISTS "hidden_at" TIMESTAMPTZ(6);
ALTER TABLE "coffee_meetups" ADD COLUMN IF NOT EXISTS "hidden_by_id" UUID;
ALTER TABLE "coffee_meetups" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMPTZ(6);
ALTER TABLE "coffee_meetups" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ(6);

ALTER TABLE "coffee_meetup_requests" ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMPTZ(6);
ALTER TABLE "coffee_meetup_requests" ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMPTZ(6);
ALTER TABLE "coffee_meetup_requests" ADD COLUMN IF NOT EXISTS "withdrawn_at" TIMESTAMPTZ(6);

ALTER TABLE "coffee_meetup_reports" ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMPTZ(6);
ALTER TABLE "coffee_meetup_reports" ADD COLUMN IF NOT EXISTS "resolved_by_id" UUID;
ALTER TABLE "coffee_meetup_reports" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coffee_meetups' AND column_name = 'cafe_slug'
  ) THEN
    UPDATE "coffee_meetups" m
    SET "cafe_id" = c."id"::text
    FROM "cafes" c
    WHERE m."cafe_slug" = c."slug"
      AND m."cafe_id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  END IF;
END $$;

ALTER TABLE "coffee_meetups" ALTER COLUMN "cafe_id" TYPE UUID USING "cafe_id"::uuid;
ALTER TABLE "coffee_meetups" ALTER COLUMN "organizer_id" TYPE UUID USING "organizer_id"::uuid;
ALTER TABLE "coffee_meetup_requests" ALTER COLUMN "requester_id" TYPE UUID USING "requester_id"::uuid;
ALTER TABLE "coffee_meetup_reports" ALTER COLUMN "reporter_id" TYPE UUID USING "reporter_id"::uuid;

ALTER TABLE "coffee_meetups" DROP COLUMN IF EXISTS "cafe_slug";
ALTER TABLE "coffee_meetups" DROP COLUMN IF EXISTS "cafe_name";
ALTER TABLE "coffee_meetups" DROP COLUMN IF EXISTS "cafe_district";
ALTER TABLE "coffee_meetups" DROP COLUMN IF EXISTS "cafe_address";
ALTER TABLE "coffee_meetups" DROP COLUMN IF EXISTS "organizer_name";
ALTER TABLE "coffee_meetups" DROP COLUMN IF EXISTS "accepted_participant_names";
ALTER TABLE "coffee_meetups" DROP COLUMN IF EXISTS "accepted_count";
ALTER TABLE "coffee_meetup_requests" DROP COLUMN IF EXISTS "requester_name";
ALTER TABLE "coffee_meetup_reports" DROP COLUMN IF EXISTS "reporter_name";

DROP INDEX IF EXISTS "coffee_meetups_status_starts_idx";
DROP INDEX IF EXISTS "coffee_meetups_cafe_idx";
DROP INDEX IF EXISTS "coffee_meetups_organizer_idx";
DROP INDEX IF EXISTS "coffee_meetup_requests_meetup_status_idx";
DROP INDEX IF EXISTS "coffee_meetup_requests_requester_idx";
DROP INDEX IF EXISTS "coffee_meetup_reports_meetup_idx";

CREATE INDEX IF NOT EXISTS "idx_coffee_meetups_status_hidden_starts" ON "coffee_meetups"("status", "is_hidden", "starts_at");
CREATE INDEX IF NOT EXISTS "idx_coffee_meetups_cafe_starts" ON "coffee_meetups"("cafe_id", "starts_at");
CREATE INDEX IF NOT EXISTS "idx_coffee_meetups_organizer_starts" ON "coffee_meetups"("organizer_id", "starts_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_coffee_meetup_requests_meetup_status" ON "coffee_meetup_requests"("meetup_id", "status");
CREATE INDEX IF NOT EXISTS "idx_coffee_meetup_requests_requester_status" ON "coffee_meetup_requests"("requester_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "coffee_meetup_requests_meetup_requester_key" ON "coffee_meetup_requests"("meetup_id", "requester_id");
CREATE INDEX IF NOT EXISTS "idx_coffee_meetup_reports_meetup_created" ON "coffee_meetup_reports"("meetup_id", "created_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "coffee_meetup_reports_meetup_reporter_key" ON "coffee_meetup_reports"("meetup_id", "reporter_id");

ALTER TABLE "coffee_meetups" ADD CONSTRAINT "coffee_meetups_time_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "coffee_meetups" ADD CONSTRAINT "coffee_meetups_capacity_check" CHECK ("max_participants" BETWEEN 2 AND 10);
ALTER TABLE "coffee_meetups" ADD CONSTRAINT "coffee_meetups_status_check" CHECK ("status" IN ('open', 'full', 'cancelled', 'completed'));
ALTER TABLE "coffee_meetup_requests" ADD CONSTRAINT "coffee_meetup_requests_status_check" CHECK ("status" IN ('pending', 'accepted', 'rejected', 'withdrawn'));

ALTER TABLE "coffee_meetups" ADD CONSTRAINT "coffee_meetups_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coffee_meetups" ADD CONSTRAINT "coffee_meetups_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coffee_meetups" ADD CONSTRAINT "coffee_meetups_hidden_by_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coffee_meetup_requests" ADD CONSTRAINT "coffee_meetup_requests_meetup_id_fkey" FOREIGN KEY ("meetup_id") REFERENCES "coffee_meetups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coffee_meetup_requests" ADD CONSTRAINT "coffee_meetup_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coffee_meetup_reports" ADD CONSTRAINT "coffee_meetup_reports_meetup_id_fkey" FOREIGN KEY ("meetup_id") REFERENCES "coffee_meetups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coffee_meetup_reports" ADD CONSTRAINT "coffee_meetup_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coffee_meetup_reports" ADD CONSTRAINT "coffee_meetup_reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "coffee_meetups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coffee_meetup_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coffee_meetup_reports" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can create reports" ON "coffee_meetup_reports";
DROP POLICY IF EXISTS "reporter or organizer can read reports" ON "coffee_meetup_reports";
DROP POLICY IF EXISTS "authenticated can create requests" ON "coffee_meetup_requests";
DROP POLICY IF EXISTS "requester or organizer can read requests" ON "coffee_meetup_requests";
DROP POLICY IF EXISTS "requester or organizer can update requests" ON "coffee_meetup_requests";
DROP POLICY IF EXISTS "authenticated can create meetups" ON "coffee_meetups";
DROP POLICY IF EXISTS "organizer can delete meetups" ON "coffee_meetups";
DROP POLICY IF EXISTS "organizer can manage meetups" ON "coffee_meetups";
DROP POLICY IF EXISTS "public can read meetups" ON "coffee_meetups";

CREATE POLICY "public can read meetups" ON "coffee_meetups" FOR SELECT USING (true);
CREATE POLICY "authenticated can create meetups" ON "coffee_meetups" FOR INSERT WITH CHECK ("organizer_id" = auth.uid());
CREATE POLICY "organizer can manage meetups" ON "coffee_meetups" FOR UPDATE USING ("organizer_id" = auth.uid()) WITH CHECK ("organizer_id" = auth.uid());
CREATE POLICY "organizer can delete meetups" ON "coffee_meetups" FOR DELETE USING ("organizer_id" = auth.uid());

CREATE POLICY "authenticated can create requests" ON "coffee_meetup_requests" FOR INSERT WITH CHECK ("requester_id" = auth.uid());
CREATE POLICY "requester or organizer can read requests" ON "coffee_meetup_requests" FOR SELECT USING (
  "requester_id" = auth.uid()
  OR EXISTS (
    SELECT 1 FROM "coffee_meetups" m
    WHERE m."id" = "coffee_meetup_requests"."meetup_id"
      AND m."organizer_id" = auth.uid()
  )
);
CREATE POLICY "requester or organizer can update requests" ON "coffee_meetup_requests" FOR UPDATE USING (
  "requester_id" = auth.uid()
  OR EXISTS (
    SELECT 1 FROM "coffee_meetups" m
    WHERE m."id" = "coffee_meetup_requests"."meetup_id"
      AND m."organizer_id" = auth.uid()
  )
) WITH CHECK (
  "requester_id" = auth.uid()
  OR EXISTS (
    SELECT 1 FROM "coffee_meetups" m
    WHERE m."id" = "coffee_meetup_requests"."meetup_id"
      AND m."organizer_id" = auth.uid()
  )
);

CREATE POLICY "authenticated can create reports" ON "coffee_meetup_reports" FOR INSERT WITH CHECK ("reporter_id" = auth.uid());
CREATE POLICY "reporter or organizer can read reports" ON "coffee_meetup_reports" FOR SELECT USING (
  "reporter_id" = auth.uid()
  OR EXISTS (
    SELECT 1 FROM "coffee_meetups" m
    WHERE m."id" = "coffee_meetup_reports"."meetup_id"
      AND m."organizer_id" = auth.uid()
  )
);
