import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { S3Client } from '@aws-sdk/client-s3';
import sharp = require('sharp');
import { StorageService } from '../src/storage/storage.service';
import { SubmissionMediaService } from '../src/submissions/submission-media.service';

const values = {
  IMAGE_STORAGE_PROVIDER: 'r2',
  R2_ACCOUNT_ID: 'test',
  R2_ACCESS_KEY_ID: 'test',
  R2_SECRET_ACCESS_KEY: 'test',
  R2_BUCKET: 'images',
  R2_PUBLIC_URL: 'https://images.test',
  CLOUDINARY_CLOUD_NAME: 'test',
  CLOUDINARY_API_KEY: 'test',
  CLOUDINARY_API_SECRET: 'test',
};
const storage = (overrides = {}) =>
  new StorageService({
    get: (key: string, fallback = '') => ({ ...values, ...overrides })[key] ?? fallback,
  } as any);

test('lost R2 PUT response compensates the exact key; failed compensation logs it without masking timeout', async () => {
  const objects = new Set<string>();
  const requests: { method: string; path: string }[] = [];
  let deleteFails = false;
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    const path = new URL(req.url!, 'http://local').pathname;
    requests.push({ method: req.method!, path });
    if (req.method === 'PUT') {
      objects.add(path);
      req.socket.destroy();
      return;
    }
    if (req.method !== 'DELETE') {
      res.writeHead(501);
      res.end();
      return;
    }
    if (deleteFails) {
      res.writeHead(503, { 'Content-Type': 'application/xml' });
      res.end('<Error><Code>ServiceUnavailable</Code></Error>');
      return;
    }
    objects.delete(path);
    res.writeHead(204);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const images = storage({ R2_PUBLIC_URL: `${endpoint}/images` });
  const client = new S3Client({
    endpoint,
    region: 'auto',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
  });
  (images as any).r2Client.destroy();
  (images as any).r2Client = client;
  let commits = 0;
  const service = new SubmissionMediaService(
    {
      cafeSubmission: { findFirst: async () => ({ submissionType: 'owner', payload: {} }) },
      $transaction: async () => {
        commits++;
      },
    } as any,
    images,
  );
  const buffer = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  const file = { originalname: 'test.png', mimetype: 'image/png', buffer } as Express.Multer.File;
  const logs: any[] = [];
  const originalError = console.error;
  console.error = (value: string) => {
    logs.push(JSON.parse(value));
  };
  try {
    for (const fail of [false, true]) {
      deleteFails = fail;
      await assert.rejects(
        () => service.uploadImages('owner', 'draft', [file], 'images'),
        (error: any) => error.getStatus() === 504 && /upload timed out/.test(error.message),
      );
      assert.deepEqual(
        requests.slice(-2).map((req) => req.method),
        ['PUT', 'DELETE'],
      );
      assert.equal(requests.at(-1).path, requests.at(-2).path);
      assert.equal(objects.size, fail ? 1 : 0);
    }
    assert.equal(commits, 0);
    const cleanup = logs.find((entry) => entry.type === 'r2.upload.cleanup.failed');
    assert.equal(cleanup.bucket, 'images');
    assert.equal(`/images/${cleanup.key}`, requests.at(-1).path);
    assert.equal(cleanup.status, 503);
  } finally {
    console.error = originalError;
    client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Cloudinary delete verifies HTTP/body, accepts already deleted, and rejects missing credentials', async () => {
  let status = 503,
    body = 'Service unavailable';
  const bodies: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    bodies.push(Buffer.concat(chunks).toString());
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const images = storage();
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.cloudinary.com/v1_1/test/image/destroy');
    assert.equal(init.method, 'POST');
    assert.ok(init.signal);
    return originalFetch(endpoint, init);
  };
  const url = 'https://res.cloudinary.com/test/image/upload/v1/submissions/draft/images/asset.webp';
  try {
    await assert.rejects(
      () => images.deleteImage(url),
      (error: any) => error.getStatus() === 502,
    );
    status = 200;
    body = JSON.stringify({ result: 'error' });
    await assert.rejects(
      () => images.deleteImage(url),
      (error: any) => error.getStatus() === 502,
    );
    body = 'malformed JSON';
    await assert.rejects(
      () => images.deleteImage(url),
      (error: any) => error.getStatus() === 502,
    );
    for (const result of ['ok', 'not found']) {
      body = JSON.stringify({ result });
      await images.deleteImage(url);
    }
    assert.equal(bodies.length, 5);
    assert.match(bodies[0], /submissions\/draft\/images\/asset/);
    assert.match(bodies[0], /name="signature"/);
    global.fetch = async () => {
      throw new DOMException('timeout', 'TimeoutError');
    };
    await assert.rejects(
      () => images.deleteImage(url),
      (error: any) => error.getStatus() === 504,
    );
    const unconfigured = storage({ CLOUDINARY_API_SECRET: '' });
    try {
      await assert.rejects(() => unconfigured.deleteImage(url), /not configured for deletion/);
    } finally {
      (unconfigured as any).r2Client.destroy();
    }
  } finally {
    global.fetch = originalFetch;
    (images as any).r2Client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
