import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { validateSync } from 'class-validator';
import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ImageUploadFileValidator,
  SubmissionsController,
  validateCommunityFiles,
  validateBatchFiles,
} from '../src/submissions/submissions.controller';
import { CreateCommunitySubmissionDto } from '../src/submissions/dto/create-community-submission.dto';
import { CreateSubmissionDto } from '../src/submissions/dto/create-submission.dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { serviceFor } from './submissions.fixture';
import { isHeicImage } from '../src/storage/storage.service';

test('image upload validator accepts HEIC and HEIF by MIME or extension', () => {
  const validator = new ImageUploadFileValidator({});

  assert.equal(validator.isValid({ originalname: 'iphone.HEIC', mimetype: '' } as any), true);
  assert.equal(
    validator.isValid({ originalname: 'scan.bin', mimetype: 'image/heif' } as any),
    true,
  );
  assert.equal(
    validator.isValid({ originalname: 'notes.txt', mimetype: 'text/plain' } as any),
    false,
  );
  assert.equal(isHeicImage({ originalname: 'live.heifs', mimetype: '' } as any), true);
});

test('batch uploads reject more than 40MB before storage and accept exactly 40MB', () => {
  const files = [
    { originalname: 'first.jpg', mimetype: 'image/jpeg', size: 20 * 1024 * 1024 },
    { originalname: 'second.jpg', mimetype: 'image/jpeg', size: 20 * 1024 * 1024 },
  ] as any;
  validateBatchFiles(files);
  assert.throws(
    () => validateBatchFiles([{ ...files[0], size: files[0].size + 1 }, files[1]]),
    /Batch is too large/,
  );

  let storageCalls = 0;
  const controller = new SubmissionsController({
    uploadImages: async () => {
      storageCalls += 1;
    },
  } as any);
  assert.throws(
    () =>
      controller.uploadImages({ id: 'user-1' }, 'submission-1', [
        { ...files[0], size: files[0].size + 1 },
        files[1],
      ]),
    /Batch is too large/,
  );
  assert.equal(storageCalls, 0);
});

test('CreateSubmissionDto accepts submission type and payload with whitelist validation', () => {
  const dto = Object.assign(new CreateSubmissionDto(), {
    name: 'Owner Cafe',
    submissionType: 'owner',
    payload: { ownerName: 'Anh Chu' },
  });

  assert.deepEqual(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }), []);
});

test('community DTO rejects owner fields and requires only its public fields', () => {
  const dto = Object.assign(new CreateCommunitySubmissionDto(), {
    name: 'Community Cafe',
    googleMapsUrl: 'https://maps.test',
    payload: {},
    submissionType: 'owner',
  });

  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map((error) => error.property).sort(), ['payload', 'submissionType']);
});

test('community file validation accepts zero to eight images and rejects invalid limits', () => {
  const image = { originalname: 'cafe.jpg', mimetype: 'image/jpeg', size: 20 * 1024 * 1024 };
  validateCommunityFiles([]);
  validateCommunityFiles([image] as any);
  validateCommunityFiles([image, image] as any);
  validateCommunityFiles(Array.from({ length: 8 }, () => ({ ...image, size: 1 })) as any);
  assert.throws(
    () =>
      validateCommunityFiles([
        { ...image, mimetype: 'text/plain', originalname: 'note.txt' },
      ] as any),
    /File must be a JPEG/,
  );
  assert.throws(
    () => validateCommunityFiles(Array.from({ length: 9 }, () => ({ ...image, size: 1 })) as any),
    /At most 8 images/,
  );
  assert.throws(
    () => validateCommunityFiles([{ ...image, size: image.size + 1 }] as any),
    /File is too large/,
  );
  assert.throws(
    () => validateCommunityFiles([image, { ...image, size: image.size + 1 }] as any),
    /Batch is too large/,
  );
});

test('community route accepts optional JWT while owner routes require JWT', () => {
  const guard = new OptionalJwtAuthGuard();
  assert.deepEqual(guard.handleRequest(null, { id: 'user-1' }), { id: 'user-1' });
  assert.equal(guard.handleRequest(new Error('jwt expired'), null), null);
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, SubmissionsController.prototype.createCommunity),
    [OptionalJwtAuthGuard],
  );
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, SubmissionsController.prototype.create), [
    JwtAuthGuard,
  ]);
});

test('community submission stores ordered uploaded images for guests and members', async () => {
  const creates: any[] = [];
  const prisma = {
    cafeSubmission: { create: async ({ data }: any) => (creates.push(data), data) },
  };
  const storage = {
    uploadImage: async (file: any) => `${file.originalname}.webp`,
    deleteImage: async () => {},
  };
  const service = serviceFor(prisma as any, storage as any);
  const dto = { name: 'Community Cafe', googleMapsUrl: 'https://maps.test', note: 'Nice' };

  await service.createCommunity(undefined, dto, []);
  await service.createCommunity('user-1', dto, [{ originalname: 'one' }] as any);
  await service.createCommunity(
    'user-1',
    dto,
    Array.from({ length: 8 }, (_, index) => ({ originalname: `photo-${index}` })) as any,
  );

  assert.equal(creates[0].submittedById, undefined);
  assert.deepEqual(creates[0].payload, {
    images: [],
    imageOrientations: [],
    coverImage: null,
    coverImageCrop: { x: 50, y: 50 },
  });
  assert.equal(creates[1].submittedById, 'user-1');
  assert.deepEqual(creates[1].payload.images, ['one.webp']);
  assert.equal(creates[1].payload.coverImage, 'one.webp');
  assert.deepEqual(
    creates[2].payload.images,
    Array.from({ length: 8 }, (_, index) => `photo-${index}.webp`),
  );
  assert.deepEqual(creates[2].payload.imageOrientations, Array(8).fill('unknown'));
  assert.equal(creates[2].payload.coverImage, 'photo-0.webp');
  assert.deepEqual(creates[2].payload.coverImageCrop, { x: 50, y: 50 });
  assert.match(creates[2].id, /^[0-9a-f-]{36}$/i);
});

test('community submission deletes uploaded files when storage or database fails', async () => {
  const storageDeleted: string[] = [];
  const storageFailure = serviceFor(
    { cafeSubmission: { create: async () => ({}) } } as any,
    {
      uploadImage: async (file: any) => {
        if (file.originalname === 'bad') throw new Error('upload failed');
        return `${file.originalname}.webp`;
      },
      deleteImage: async (url: string) => storageDeleted.push(url),
    } as any,
  );
  await assert.rejects(
    () =>
      storageFailure.createCommunity(
        undefined,
        { name: 'Cafe', googleMapsUrl: 'https://maps.test' },
        [{ originalname: 'ok' }, { originalname: 'bad' }] as any,
      ),
    /upload failed/,
  );
  assert.deepEqual(storageDeleted, ['ok.webp']);

  const databaseDeleted: string[] = [];
  const databaseFailure = serviceFor(
    {
      cafeSubmission: {
        create: async () => {
          throw new Error('database failed');
        },
      },
    } as any,
    {
      uploadImage: async (file: any) => `${file.originalname}.webp`,
      deleteImage: async (url: string) => databaseDeleted.push(url),
    } as any,
  );
  await assert.rejects(
    () =>
      databaseFailure.createCommunity(
        undefined,
        { name: 'Cafe', googleMapsUrl: 'https://maps.test' },
        [{ originalname: 'one' }, { originalname: 'two' }] as any,
      ),
    /database failed/,
  );
  assert.deepEqual(databaseDeleted.sort(), ['one.webp', 'two.webp']);
});

test('community submission cleans up after Cloudinary failures and timeouts', async () => {
  for (const error of [
    new BadGatewayException('Image storage upload failed'),
    new GatewayTimeoutException('Image storage upload timed out'),
  ]) {
    const deleted: string[] = [];
    const service = serviceFor(
      { cafeSubmission: { create: async () => ({}) } } as any,
      {
        uploadImage: async (file: any) => {
          if (file.originalname === 'failed') throw error;
          return `${file.originalname}.webp`;
        },
        deleteImage: async (url: string) => deleted.push(url),
      } as any,
    );

    await assert.rejects(
      () =>
        service.createCommunity(undefined, { name: 'Cafe', googleMapsUrl: 'https://maps.test' }, [
          { originalname: 'uploaded' },
          { originalname: 'failed' },
        ] as any),
      (caught: any) => caught.getStatus?.() === error.getStatus(),
    );
    assert.deepEqual(deleted, ['uploaded.webp']);
  }
});

test('getMe lists visible current-user submissions newest first with linked cafe fields', async () => {
  let findManyArgs: any;
  const prisma = {
    cafeSubmission: {
      findMany: async (args: any) => {
        findManyArgs = args;
        return [];
      },
    },
  };
  const service = serviceFor(prisma as any, {} as any);

  assert.deepEqual(await service.getMe('user-1'), []);
  assert.deepEqual(findManyArgs.where, { submittedById: 'user-1', isHidden: false });
  assert.deepEqual(findManyArgs.orderBy, { createdAt: 'desc' });
  assert.deepEqual(findManyArgs.include.createdCafe.select, {
    id: true,
    name: true,
    slug: true,
    address: true,
    district: true,
    coverImage: true,
    isPublished: true,
  });
});
