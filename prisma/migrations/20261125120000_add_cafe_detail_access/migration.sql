BEGIN;

CREATE TABLE "cafe_detail_opens" (
    "identity" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "cafe_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "free" BOOLEAN NOT NULL,
    CONSTRAINT "cafe_detail_opens_pkey" PRIMARY KEY ("identity", "month", "cafe_id")
);

CREATE TABLE "cafe_detail_browser_months" (
    "browser" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    CONSTRAINT "cafe_detail_browser_months_pkey" PRIMARY KEY ("browser", "month")
);

CREATE TABLE "cafe_detail_entitlements" (
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "cafe_detail_entitlements_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "cafe_detail_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "cafe_detail_opens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cafe_detail_browser_months" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cafe_detail_entitlements" ENABLE ROW LEVEL SECURITY;

REVOKE SELECT ON TABLE "cafes" FROM PUBLIC;

DO $$
DECLARE
    browser_role text;
BEGIN
    FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
    LOOP
        EXECUTE format('REVOKE SELECT ON TABLE "cafes" FROM %I', browser_role);
    END LOOP;
END $$;

COMMIT;
