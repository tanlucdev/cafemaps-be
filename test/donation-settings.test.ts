import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import sharp = require('sharp');
import { DonationSettingsService } from '../src/donation-settings/donation-settings.service';
import { UpdateDonationSettingsDto } from '../src/donation-settings/donation-settings.dto';
import { AdminDonationSettingsController } from '../src/donation-settings/donation-settings.controller';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';

const validation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const parse = (value: unknown) =>
  validation.transform(value, {
    type: 'body',
    metatype: UpdateDonationSettingsDto,
  });

test('multipart false stays false; trims text; rejects invalid booleans and unknown fields', async () => {
  for (const enabled of [false, 'false']) {
    const dto = await parse({ enabled, titleVi: '  Tiêu đề  ', titleEn: '   ' });
    assert.equal(dto.enabled, false);
    assert.equal(dto.titleVi, 'Tiêu đề');
    assert.equal(dto.titleEn, null);
  }
  for (const enabled of [true, 'true']) assert.equal((await parse({ enabled })).enabled, true);
  for (const enabled of [undefined, null, 'yes', '', 1, 0, [], {}]) {
    await assert.rejects(() => parse({ enabled }), BadRequestException);
  }
  await assert.rejects(() => parse({ enabled: true, qrImageUrl: 'https://untrusted.test/qr' }));
  await assert.rejects(() => parse({ enabled: true, titleVi: 'x'.repeat(121) }));
  await assert.rejects(() => parse({ enabled: true, descriptionEn: 'x'.repeat(501) }));
  await assert.rejects(() => parse({ enabled: true, titleEn: { nested: 'bad' } }));
});

test('donation admin endpoints require both JWT and current ADMIN role', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AdminDonationSettingsController), [
    JwtAuthGuard,
    RolesGuard,
  ]);
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, AdminDonationSettingsController), ['ADMIN']);
});

test('defaults are read-only; disabling without an upload preserves stored QR', async () => {
  let stored: any = null;
  const service = new DonationSettingsService(
    {
      donationSettings: {
        findUnique: async () => stored,
        upsert: async ({ create, update }: any) =>
          (stored = stored ? { ...stored, ...update } : create),
      },
    } as any,
    {} as any,
  );
  assert.equal((await service.get()).enabled, true);
  assert.equal(stored, null);
  stored = { enabled: true, qrImageUrl: 'https://cdn.test/qr.webp' };
  const saved = await service.update(await parse({ enabled: 'false' }));
  assert.equal(saved.enabled, false);
  assert.equal(saved.qrImageUrl, 'https://cdn.test/qr.webp');
  assert.equal((await service.get()).enabled, false);
});

test('invalid image fails before upload; failed writes retain images in case commit succeeded', async () => {
  let uploads = 0;
  let writes = 0;
  const deleted: string[] = [];
  const service = new DonationSettingsService(
    {
      donationSettings: {
        upsert: async () => {
          writes++;
          throw new Error('Database unavailable');
        },
      },
    } as any,
    {
      uploadImage: async () => {
        uploads++;
        return 'https://cdn.test/new.webp';
      },
      deleteImage: async (url: string) => {
        deleted.push(url);
      },
    } as any,
  );
  const dto = await parse({ enabled: true });
  await assert.rejects(
    () => service.update(dto, { buffer: Buffer.from('<svg/>') } as any),
    BadRequestException,
  );
  assert.equal(uploads, 0);
  assert.equal(writes, 0);
  const file = {
    buffer: await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } })
      .png()
      .toBuffer(),
  } as any;
  await assert.rejects(() => service.update(dto, file), /Database unavailable/);
  assert.equal(uploads, 1);
  assert.deepEqual(deleted, []);
  const storageFailure = new DonationSettingsService(
    {
      donationSettings: {
        upsert: async () => {
          throw new Error('Must not write');
        },
      },
    } as any,
    {
      uploadImage: async () => {
        throw new Error('Storage unavailable');
      },
    } as any,
  );
  await assert.rejects(() => storageFailure.update(dto, file), /Storage unavailable/);
});
