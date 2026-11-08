import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { S3Client } from '@aws-sdk/client-s3';
import sharp = require('sharp');
import { AdminCafesService } from '../src/admin/cafes/admin-cafes.service';
import {
  getImageStorageProvider,
  r2ObjectKeyFromPublicUrl,
  StorageService,
} from '../src/storage/storage.service';

const config = {
  IMAGE_STORAGE_PROVIDER: 'r2',
  R2_ACCOUNT_ID: 'account',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'images',
  R2_PUBLIC_URL: 'https://images.example.test/cafe',
};

function storage(overrides = {}) {
  const values = { ...config, ...overrides };
  return new StorageService({
    get: (key: string, fallback = '') => values[key] ?? fallback,
  } as any);
}

test('R2 requires complete configuration and a valid public URL', () => {
  assert.equal(getImageStorageProvider('r2'), 'r2');
  assert.doesNotThrow(() => storage({ SUPABASE_SERVICE_KEY: 'unused-legacy-key' }));
  for (const key of Object.keys(config).filter((key) => key.startsWith('R2_'))) {
    assert.throws(() => storage({ [key]: '' }), /R2 requires/);
  }
  for (const url of [
    'invalid',
    'ftp://images.test',
    'https://user:pass@images.test',
    'https://images.test?token=secret',
  ]) {
    assert.throws(() => storage({ R2_PUBLIC_URL: url }), /R2_PUBLIC_URL must/);
  }
});

test('menu uploads WebP through S3 HTTP, preserves pages, and leaves DB untouched on failure', async () => {
  const requests: { method: string; path: string; contentType: string; body: Buffer }[] = [];
  let rejectUpload = false;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({
      method: req.method!,
      path: req.url!,
      contentType: req.headers['content-type']!,
      body: Buffer.concat(chunks),
    });
    if (rejectUpload) {
      res.writeHead(403, { 'Content-Type': 'application/xml' });
      res.end('<Error><Code>AccessDenied</Code><Message>Access denied</Message></Error>');
    } else {
      res.writeHead(req.method === 'DELETE' ? 204 : 200, { ETag: '"test"' });
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = new S3Client({
    region: 'auto',
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    forcePathStyle: true,
    credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
    maxAttempts: 1,
  });
  const images = storage();
  (images as any).r2Client.destroy();
  (images as any).r2Client = client;
  const oldMenu = `${config.R2_PUBLIC_URL}/cafes/cafe-1/menu/old.webp`;
  let updates = 0;
  const service = new AdminCafesService(
    {
      cafe: {
        findUnique: async () => ({
          id: 'cafe-1',
          slug: 'cafe',
          menuImage: oldMenu,
          menuImages: [oldMenu],
        }),
        update: async ({ data }: any) => {
          updates++;
          return { slug: 'cafe', ...data };
        },
      },
    } as any,
    images,
    { trigger: async () => undefined } as any,
  );
  const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  const file = {
    originalname: 'menu ảnh.png',
    mimetype: 'image/png',
    buffer,
  } as Express.Multer.File;
  try {
    const result = await service.uploadCafeMenuImage('cafe-1', file);
    assert.match(
      result.url,
      /^https:\/\/images\.example\.test\/cafe\/cafes\/cafe-1\/menu\/.+\.webp$/,
    );
    assert.deepEqual(result.menuImages, [oldMenu, result.url]);
    assert.equal(result.menuImage, oldMenu);
    assert.equal(requests[0].method, 'PUT');
    assert.equal(requests[0].contentType, 'image/webp');
    assert.equal((await sharp(requests[0].body).metadata()).format, 'webp');
    const key = r2ObjectKeyFromPublicUrl(result.url, config.R2_PUBLIC_URL);
    assert.equal(new URL(requests[0].path, 'http://localhost').pathname, `/images/${key}`);
    await images.deleteImage('https://elsewhere.test/image.webp');
    assert.equal(requests.length, 1);
    await images.deleteImage(result.url);
    assert.equal(requests[1].method, 'DELETE');
    assert.equal(requests[1].path, requests[0].path.replace(/\?.*$/, '') + '?x-id=DeleteObject');
    rejectUpload = true;
    await assert.rejects(
      () => service.uploadCafeMenuImage('cafe-1', file),
      (error: any) => error.getStatus() === 502,
    );
    assert.equal(updates, 1);
  } finally {
    client.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('R2 deletion only accepts URLs inside the configured public path', () => {
  for (const url of [
    'https://images.example.test/other/a.webp',
    'https://images.example.test/cafe/%2E%2E/secret',
    'https://images.example.test/cafe/a.webp?token=x',
    'https://user:pass@images.example.test/cafe/a.webp',
    'https://images.example.test/cafe/cafes%2Fa.webp',
  ]) {
    assert.equal(r2ObjectKeyFromPublicUrl(url, config.R2_PUBLIC_URL), null);
  }
});
