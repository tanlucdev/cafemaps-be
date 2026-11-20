// Local browser harness. Uses only OWNER_R2_TEST_DATABASE_URL; never load production .env.
import { writeFile } from 'node:fs/promises';
import { ownerFixture } from './owner-r2.fixture';

void ownerFixture().then(async (fixture) => {
  await writeFile(
    '/tmp/cafe-owner-r2-browser.json',
    JSON.stringify({
      base: fixture.base,
      token: fixture.token,
      user: fixture.user,
      storageUrl: fixture.storageUrl,
    }),
    { mode: 0o600 },
  );
  console.log(`Owner R2 browser fixture: ${fixture.base}`);
  process.on('SIGINT', () => {
    void fixture.close().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void fixture.close().then(() => process.exit(0));
  });
});
