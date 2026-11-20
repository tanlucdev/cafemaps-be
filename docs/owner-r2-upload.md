# Owner gallery/menu multipart upload

FE now sends one `file` to `POST /submissions/:id/images` or `/menu`; the existing submission response adds `uploadedUrls: string[]`. Batch endpoints add the same field. Deletion uses `DELETE /submissions/:id/images` with `{ "url": "..." }`. JWT is required. Signatures/persist endpoints remain available for older clients.

Deploy backend before FE. Configure `IMAGE_STORAGE_PROVIDER=r2` and all five existing variables: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`. Keep credentials only in backend deployment settings. No dependency, schema migration, presigned upload, existing-image rewrite or production data changes.

Uploads run outside transactions. The transaction locks the draft, rereads membership/quota/status, saves payload and asset records together. Losing requests compensate uploaded objects; failed compensation logs submission ID and URL. Save preserves current media membership while accepting order/metadata edits. Removing membership requires DELETE; stale saves cannot reintroduce deleted media.

DELETE locks the draft and marks the recorded asset `delete_pending` before storage cleanup. Failure returns an error, retains the record and blocks submit. Retry the same URL even after it leaves payload. After successful cleanup, a repeated DELETE returns 404 without modifying another asset.

## Verification

- `npm test`: 197 pass; the opt-in HTTP suite skips without its explicit test DB.
- `npm run build`, `npx tsc --noEmit`, targeted ESLint: pass.
- HTTP suite: 9 pass against real local PostgreSQL and a local S3 HTTP server. Exercises multipart, WebP bytes/public URL, JWT, UUID/owner/status, 20 MiB rejection, quota contention, stale save, submit race, delete retry, cover/orientation, storage 503/connection failure and legacy signatures/community upload.
- Failure unit checks inject DB rollback and failed compensation, preserving the original error and logging cleanup failures.
- Paired FE browser check covers gallery/menu, order, two requests, cover, delete failure/retry, failed-upload replacement, preview and save/submit; asserts no Cloudinary POST.

Reproduce HTTP checks with a disposable local DB (never production):

```sh
createdb cafe_owner_r2_test
psql -d cafe_owner_r2_test -c 'CREATE EXTENSION IF NOT EXISTS postgis'
export OWNER_R2_TEST_DATABASE_URL=postgresql://localhost/cafe_owner_r2_test
DATABASE_URL="$OWNER_R2_TEST_DATABASE_URL" DIRECT_URL="$OWNER_R2_TEST_DATABASE_URL" npx prisma db push --skip-generate
TS_NODE_PREFER_TS_EXTS=true node --test -r ts-node/register test/owner-r2.http.test.ts
```

The fixture requires a database name ending in `_test`, creates unique local test users and deletes their submissions at teardown. Its S3 server models PUT/GET/DELETE and errors; it does not validate AWS signatures, R2 permissions or production networking. No Postman workspace resources were changed. Published mock discovery was unavailable (`postman status` unsupported); the local S3 stand-in follows the existing AWS SDK calls.

For the FE browser harness, start `OWNER_R2_TEST_DATABASE_URL=... TS_NODE_PREFER_TS_EXTS=true node -r ts-node/register test/owner-r2.browser-server.ts`. It writes a local-only test session to `/tmp/cafe-owner-r2-browser.json`. Point FE `API_URL` at the printed address, run FE on port 3117, then follow the FE document. Stop the harness to clean its test user/submissions.

## Release smoke test

Upload one gallery and one menu image. Confirm public URLs load, draft and preview retain them, Network contains no Cloudinary upload, then delete the test images. Production remains unverified until this smoke test runs. No merge/deploy performed here. Rolling FE back to Cloudinary may restore the original upload failure; it is not a reliable upload recovery. Existing Cloudinary 401 recovery is a separate task.
