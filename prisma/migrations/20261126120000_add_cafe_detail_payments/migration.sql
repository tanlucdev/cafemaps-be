BEGIN;

CREATE TABLE "cafe_detail_payments" (
    "order_code" BIGINT PRIMARY KEY,
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "payment_link_id" TEXT UNIQUE,
    "checkout_url" TEXT,
    "qr_code" TEXT
);

CREATE INDEX "cafe_detail_payments_user_id_expires_at_idx"
    ON "cafe_detail_payments" ("user_id", "expires_at");
ALTER TABLE "cafe_detail_payments" ENABLE ROW LEVEL SECURITY;

COMMIT;
