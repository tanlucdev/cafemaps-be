import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import sharp = require('sharp');
import { ownerFixture } from './owner-r2.fixture';

const enabled = Boolean(process.env.OWNER_R2_TEST_DATABASE_URL);
test(
  'owner multipart HTTP with real PostgreSQL and S3 HTTP: upload, locks, deletion and failures',
  { skip: !enabled },
  async (t) => {
    const f = await ownerFixture();
    const buffer = await sharp({
      create: { width: 2, height: 3, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const upload = (id: string, route = 'images', bytes = buffer, token = f.token) => {
      const body = new FormData();
      body.set('file', new Blob([new Uint8Array(bytes)]), 'image.png');
      return f.request(`/${id}/${route}`, { method: 'POST', body }, token);
    };
    const remove = (id: string, url: string) =>
      f.request(`/${id}/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
    try {
      await t.test(
        'JWT, UUID, ownership, decode and interceptor size rejected before storage',
        async () => {
          const draft = await f.create();
          const before = f.requests.length;
          assert.equal((await upload(draft.id, 'images', buffer, '')).status, 401);
          assert.equal((await upload('invalid')).status, 400);
          const other = await f.db.cafeSubmission.create({
            data: { name: 'Other', status: 'draft', submissionType: 'owner' },
          });
          assert.equal((await upload(other.id)).status, 404);
          await f.db.cafeSubmission.delete({ where: { id: other.id } });
          assert.equal((await upload(draft.id, 'images', Buffer.from('not an image'))).status, 400);
          assert.equal(
            (await upload(draft.id, 'images', Buffer.alloc(20 * 1024 * 1024 + 1))).status,
            413,
          );
          assert.equal(f.requests.length, before);
        },
      );
      await t.test('gallery/menu/batch response URLs, WebP, payload, asset records', async () => {
        const draft = await f.create();
        for (const route of ['images', 'menu']) {
          const response = await upload(draft.id, route);
          assert.equal(response.status, 201);
          const result: any = await response.json();
          assert.equal(result.uploadedUrls.length, 1);
          const field = route === 'images' ? 'images' : 'menuImages';
          assert.deepEqual(result.payload[field], result.uploadedUrls);
          assert.equal((await fetch(result.uploadedUrls[0])).status, 200);
        }
        const body = new FormData();
        body.append('files', new Blob([new Uint8Array(buffer)]), 'a.png');
        body.append('files', new Blob([new Uint8Array(buffer)]), 'b.png');
        const result: any = await (
          await f.request(`/${draft.id}/images/batch`, { method: 'POST', body })
        ).json();
        assert.equal(result.uploadedUrls.length, 2);
        assert.deepEqual(result.payload.images.slice(1), result.uploadedUrls);
        assert.equal(await f.db.submissionAsset.count({ where: { submissionId: draft.id } }), 4);
        for (const request of f.requests.filter((req) => req.method === 'PUT')) {
          assert.equal(request.contentType, 'image/webp');
          assert.equal((await sharp(request.body).metadata()).format, 'webp');
        }
      });
      await t.test(
        'two concurrent requests contend for slot twelve; rejected object cleaned',
        async () => {
          const draft = await f.create({
            images: Array.from({ length: 11 }, (_, i) => `old-${i}`),
          });
          const before = f.objects.size;
          const results = await Promise.all([upload(draft.id), upload(draft.id)]);
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
          const latest: any = await f.db.cafeSubmission.findUnique({ where: { id: draft.id } });
          assert.equal(latest.payload.images.length, 12);
          assert.equal(f.objects.size, before + 1);
        },
      );
      await t.test(
        'stale save concurrent with upload preserves latest media and text; stale save cannot resurrect a deletion',
        async () => {
          const draft = await f.create();
          const result: any = await (await upload(draft.id)).json();
          const url = result.uploadedUrls[0];
          const patch = () =>
            f.request(`/${draft.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: 'Edited', payload: { name: 'Edited', images: [url] } }),
            });
          const [saved, uploaded] = await Promise.all([patch(), upload(draft.id, 'menu')]);
          assert.equal(saved.status, 200);
          assert.equal(uploaded.status, 201);
          await remove(draft.id, url);
          await patch();
          const latest: any = await f.db.cafeSubmission.findUnique({ where: { id: draft.id } });
          assert.deepEqual(latest.payload.images, []);
          assert.equal(latest.payload.menuImages.length, 1);
          assert.equal(latest.payload.name, 'Edited');
        },
      );
      await t.test(
        'cover/orientation deletion; storage failure preserves pending record, blocks submit, retry cleans',
        async () => {
          const draft = await f.create();
          const a: any = await (await upload(draft.id)).json();
          const b: any = await (await upload(draft.id)).json();
          const [first, second] = [a.uploadedUrls[0], b.uploadedUrls[0]];
          await f.db.cafeSubmission.update({
            where: { id: draft.id },
            data: {
              payload: {
                ...b.payload,
                imageOrientations: ['portrait', 'landscape'],
                coverImage: first,
                coverImageCrop: { x: 20, y: 30 },
              },
            },
          });
          const before = f.requests.length;
          assert.equal((await remove(draft.id, 'https://outside.test/image')).status, 404);
          assert.equal(f.requests.length, before);
          f.mode('delete_fail');
          assert.equal((await remove(draft.id, first)).status, 502);
          const latest: any = await f.db.cafeSubmission.findUnique({ where: { id: draft.id } });
          assert.deepEqual(latest.payload.images, [second]);
          assert.deepEqual(latest.payload.imageOrientations, ['landscape']);
          assert.equal(latest.payload.coverImage, second);
          assert.deepEqual(latest.payload.coverImageCrop, { x: 50, y: 50 });
          assert.equal((await f.request(`/${draft.id}/submit`, { method: 'POST' })).status, 400);
          f.mode('ok');
          assert.equal((await remove(draft.id, first)).status, 200);
          assert.equal(
            await f.db.submissionAsset.count({
              where: { submissionId: draft.id, secureUrl: first },
            }),
            0,
          );
          assert.equal((await remove(draft.id, first)).status, 404);
          assert.equal((await f.request(`/${draft.id}/submit`, { method: 'POST' })).status, 201);
          const beforeSubmitted = f.requests.length;
          assert.equal((await upload(draft.id)).status, 404);
          assert.equal(f.requests.length, beforeSubmitted);
        },
      );
      await t.test('storage 5xx/connection loss never commits URLs', async () => {
        const draft = await f.create();
        for (const mode of ['fail', 'timeout']) {
          f.mode(mode);
          assert.equal((await upload(draft.id)).status, mode === 'timeout' ? 504 : 502);
          const latest: any = await f.db.cafeSubmission.findUnique({ where: { id: draft.id } });
          assert.equal(latest.payload.images, undefined);
        }
        f.mode('ok');
      });
      await t.test(
        'upload concurrent with submit either commits first or compensates; pending payload is stable',
        async () => {
          const draft = await f.create({
            images: ['legacy'],
            openingTime: '07:00',
            closingTime: '22:00',
          });
          const [media, submitted] = await Promise.all([
            upload(draft.id),
            f.request(`/${draft.id}/submit`, { method: 'POST' }),
          ]);
          assert.equal(submitted.status, 201);
          assert.ok([201, 404].includes(media.status));
          const latest: any = await f.db.cafeSubmission.findUnique({ where: { id: draft.id } });
          assert.equal(latest.status, 'pending');
          assert.equal(latest.payload.images.length, media.status === 201 ? 2 : 1);
        },
      );
      await t.test(
        'legacy signatures remain Cloudinary; community multipart stays functional',
        async () => {
          const draft = await f.create();
          const signed = await f.request(`/${draft.id}/assets/signatures`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assets: [{ field: 'images' }] }),
          });
          assert.equal(signed.status, 201);
          assert.equal(((await signed.json()) as any).cloudName, 'test');
          const body = new FormData();
          body.set('name', 'Community');
          body.set('googleMapsUrl', 'https://maps.test');
          body.set('photos', new Blob([new Uint8Array(buffer)]), 'cafe.png');
          const response = await f.request('/community', { method: 'POST', body });
          assert.equal(response.status, 201);
        },
      );
    } finally {
      await f.close();
    }
  },
);
