BEGIN;

ALTER TABLE "cafe_detail_payments"
  ADD COLUMN "amount" INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN "offer_released_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "cafe_detail_payments_positive_amount" CHECK ("amount" > 0);

ALTER TABLE "cafe_detail_payments" ALTER COLUMN "amount" DROP DEFAULT;

COMMIT;
