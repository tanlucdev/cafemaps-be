# Donation settings

- `GET /api/donation-settings`: public; `Cache-Control: no-store`.
- `GET /api/admin/donation-settings`: JWT + current ADMIN role.
- `PUT /api/admin/donation-settings`: JWT + current ADMIN role; JSON or multipart form.

Response: `{ enabled, qrImageUrl, titleVi, titleEn, descriptionVi, descriptionEn }`.
`enabled` controls only the footer donation section; all other response fields are strings or null.
The floating button keeps its bundled QR, localized copy and feedback independently of these settings.
Before the first save, returns `enabled: true` and null for other fields, preserving the bundled QR and localized copy.

PUT requires `enabled` (boolean in JSON, `"true"` / `"false"` in multipart).
Text fields are optional; omitted preserves existing text, blank/null restores the localized frontend default.
Titles: up to 120 characters. Descriptions: up to 500 characters. Text is trimmed.
Optional `file`: JPEG, PNG, or WebP, up to 5 MB and 16 megapixels; validated by decoding metadata.
No file preserves the current QR. Image storage is reused; clients cannot submit arbitrary QR URLs.
Only a successful save publishes the new QR. Uploads are retained on database errors because a timeout may occur after a committed save; deleting then could break the saved QR.
Previous published images remain available to visitors who already loaded them.

Invalid input returns 400; missing/invalid JWT returns 401; non-admin returns 403.
Storage/database failures return 5xx and retain the saved settings.
The frontend hides the footer donation section on read failure, refreshes on focus and every 60 seconds while visible.
CMS save failures preserve the draft and selected file for retry.

Apply `prisma/migrations/20261114000000_add_donation_settings/migration.sql` using the project's migration workflow before deploying the backend. No seed is needed.

## Local storage stand-in

`postman simulation run test/fixtures/donation-storage.sim.yaml --port 4010 --no-history`

Start the backend with a disposable local database and override `IMAGE_STORAGE_PROVIDER=supabase`, `SUPABASE_URL=http://localhost:4010/storage`, `SUPABASE_SERVICE_KEY=sb_secret_local_test`, `SUPABASE_BUCKET=donation-test`. Uploads stay local.
`POST http://localhost:4010/storage/__failure` with body `true` makes uploads fail; `false` restores them.
Unit checks: `node --test -r ts-node/register test/donation-settings.test.ts`.
