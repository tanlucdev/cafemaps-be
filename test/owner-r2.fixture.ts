import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { S3Client } from '@aws-sdk/client-s3';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { SubmissionsController } from '../src/submissions/submissions.controller';
import { SubmissionAssetsController } from '../src/submissions/submission-assets.controller';
import { SubmissionAssetsService } from '../src/submissions/submission-assets.service';
import { SubmissionsService } from '../src/submissions/submissions.service';
import { SubmissionMediaService } from '../src/submissions/submission-media.service';
import { StorageService } from '../src/storage/storage.service';

export async function ownerFixture() {
  const databaseUrl = process.env.OWNER_R2_TEST_DATABASE_URL;
  if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
    throw new Error('OWNER_R2_TEST_DATABASE_URL must target a disposable database ending in _test');
  // No application env files are loaded. Every DB operation is confined to the explicit test URL.
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const objects = new Map<string, Buffer>();
  const requests: { method: string; path: string; body: Buffer; contentType?: string }[] = [];
  let mode = 'ok';
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const path = new URL(req.url!, 'http://local').pathname;
    requests.push({ method: req.method!, path, body, contentType: req.headers['content-type'] });
    if (mode === 'fail' || (mode === 'delete_fail' && req.method === 'DELETE')) {
      res.writeHead(503, { 'Content-Type': 'application/xml' });
      res.end(
        '<Error><Code>ServiceUnavailable</Code><Message>Injected storage failure</Message></Error>',
      );
      return;
    }
    if (mode === 'timeout' && req.method === 'PUT') {
      req.socket.destroy();
      return;
    }
    if (req.method === 'PUT') objects.set(path, body);
    else if (req.method === 'DELETE') objects.delete(path);
    else if (req.method === 'GET') {
      if (!objects.has(path)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/webp' });
      res.end(objects.get(path));
      return;
    } else {
      res.writeHead(501);
      res.end();
      return;
    }
    res.writeHead(req.method === 'DELETE' ? 204 : 200, { ETag: '"test"' });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const storageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const values = {
    IMAGE_STORAGE_PROVIDER: 'r2',
    R2_ACCOUNT_ID: 'test',
    R2_ACCESS_KEY_ID: 'test',
    R2_SECRET_ACCESS_KEY: 'test',
    R2_BUCKET: 'images',
    R2_PUBLIC_URL: `${storageUrl}/images`,
    JWT_SECRET: 'owner-r2-local-test-only',
    CLOUDINARY_CLOUD_NAME: 'test',
    CLOUDINARY_API_KEY: 'test',
    CLOUDINARY_API_SECRET: 'test',
    CLOUDINARY_OWNER_UPLOAD_PRESET: 'test',
  };
  const config = new ConfigService(values);
  const storage = new StorageService(config);
  const client = new S3Client({
    endpoint: storageUrl,
    forcePathStyle: true,
    region: 'auto',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
  });
  (storage as any).r2Client.destroy();
  (storage as any).r2Client = client;
  const module = await Test.createTestingModule({
    controllers: [SubmissionsController, SubmissionAssetsController],
    providers: [
      SubmissionsService,
      SubmissionMediaService,
      SubmissionAssetsService,
      JwtStrategy,
      { provide: PrismaService, useValue: db },
      { provide: StorageService, useValue: storage },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const user = await db.user.create({ data: { email: `owner-r2-${randomUUID()}@example.test` } });
  const jwt = new JwtService({ secret: values.JWT_SECRET });
  const token = jwt.sign({ sub: user.id, role: 'USER' });
  const request = (path: string, init: RequestInit = {}, auth = token) =>
    fetch(`${base}/submissions${path}`, {
      ...init,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...init.headers },
    });
  const create = async (payload: Record<string, unknown> = {}) => {
    const response = await request('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Owner test',
        submissionType: 'owner',
        payload: {
          address: 'Test address',
          openingTime: '07:00',
          closingTime: '22:00',
          ...payload,
        },
      }),
    });
    if (response.status !== 201) throw new Error(await response.text());
    return response.json() as Promise<any>;
  };
  const close = async () => {
    await app.close();
    client.destroy();
    await db.cafeSubmission.deleteMany({ where: { submittedById: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return {
    app,
    db,
    storage,
    base,
    user,
    token,
    objects,
    requests,
    request,
    create,
    close,
    mode: (value: string) => {
      mode = value;
    },
    storageUrl,
  };
}
