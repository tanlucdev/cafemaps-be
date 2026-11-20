import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { serviceFor } from './submissions.fixture';
test('submit validates owner draft before moving to pending', async () => {
  let updateArgs: any;
  const prisma = {
    cafeSubmission: {
      findFirst: async ({ where }: any) =>
        where.submittedById === 'user-1'
          ? {
              id: 'submission-1',
              submissionType: 'owner',
              name: 'Owner Cafe',
              address: null,
              googleMapsUrl: null,
              payload: {
                name: 'Owner Cafe',
                images: ['cover.webp'],
                googleMapsUrl: 'https://maps.test',
                openingTime: '07:00',
                closingTime: '22:00',
              },
            }
          : null,
      update: async (args: any) => {
        updateArgs = args;
        return { id: args.where.id, status: args.data.status };
      },
    },
  };
  const service = serviceFor(prisma as any, {} as any);

  await service.submit('user-1', 'submission-1');
  await assert.rejects(() => service.submit('user-2', 'submission-1'), /Submission not found/);

  assert.deepEqual(updateArgs, { where: { id: 'submission-1' }, data: { status: 'pending' } });
});

test('submit rejects incomplete owner draft', async () => {
  const prisma = {
    cafeSubmission: {
      findFirst: async () => ({
        id: 'submission-1',
        submissionType: 'owner',
        name: '',
        address: null,
        googleMapsUrl: null,
        payload: { images: [] },
      }),
    },
  };
  const service = serviceFor(prisma as any, {} as any);

  await assert.rejects(
    () => service.submit('user-1', 'submission-1'),
    /Missing required owner payload/,
  );
});

const thirteenImages = Array.from({ length: 13 }, (_, index) => `image-${index}.webp`);

test('owner gallery quota rejects payloads and direct uploads over twelve images', async () => {
  const createPrisma = { cafeSubmission: { create: async () => ({}) } };
  const createService = serviceFor(createPrisma as any, {} as any);
  await assert.rejects(
    () =>
      createService.create('user-1', {
        name: 'Owner',
        submissionType: 'owner',
        payload: { images: thirteenImages },
      }),
    /Owner gallery allows at most 12 images/,
  );

  const updatePrisma = {
    cafeSubmission: {
      findFirst: async () => ({ id: 'submission-1', submissionType: 'owner' }),
      update: async () => ({}),
    },
  };
  const updateService = serviceFor(updatePrisma as any, {} as any);
  await assert.rejects(
    () =>
      updateService.update('user-1', 'submission-1', {
        name: 'Owner',
        payload: { images: thirteenImages },
      }),
    /Owner gallery allows at most 12 images/,
  );

  const completePayload = {
    name: 'Owner',
    images: thirteenImages,
    googleMapsUrl: 'https://maps.test',
    openingTime: '07:00',
    closingTime: '22:00',
  };
  const submitPrisma = {
    cafeSubmission: {
      findFirst: async () => ({
        id: 'submission-1',
        submissionType: 'owner',
        name: 'Owner',
        address: null,
        googleMapsUrl: null,
        payload: completePayload,
      }),
    },
  };
  const submitService = serviceFor(submitPrisma as any, {} as any);
  await assert.rejects(
    () => submitService.submit('user-1', 'submission-1'),
    /Owner gallery allows at most 12 images/,
  );

  const uploadPrisma = {
    cafeSubmission: {
      findFirst: async () => ({
        id: 'submission-1',
        submissionType: 'owner',
        payload: { images: thirteenImages.slice(0, 12) },
      }),
    },
  };
  const uploadService = serviceFor(uploadPrisma as any, {} as any);
  await assert.rejects(
    () => uploadService.uploadImage('user-1', 'submission-1', {} as any, 'images'),
    /Owner gallery allows at most 12 images/,
  );
  await assert.rejects(
    () => uploadService.uploadImages('user-1', 'submission-1', [{}, {}] as any, 'images'),
    /Owner gallery allows at most 12 images/,
  );
});

test('owner gallery accepts the twelfth image and rechecks quota under its row lock', async () => {
  let locked = false;
  let updateArgs: any;
  const elevenImages = thirteenImages.slice(0, 11);
  const prisma = {
    cafeSubmission: {
      findFirst: async () => ({
        id: 'submission-1',
        submissionType: 'owner',
        payload: { images: elevenImages },
      }),
      update: async (args: any) => {
        updateArgs = args;
        return args;
      },
    },
    $queryRaw: async () => {
      locked = true;
    },
    $transaction: async (fn: any) => fn(prisma),
  };
  const storage = { uploadImage: async () => 'twelfth.webp', deleteImage: async () => {} };
  const service = serviceFor(prisma as any, storage as any);
  await service.uploadImages('user-1', 'submission-1', [{}] as any, 'images');
  assert.equal(locked, true);
  assert.deepEqual(updateArgs.data.payload.images, [...elevenImages, 'twelfth.webp']);

  let reads = 0;
  const deleted: string[] = [];
  const racedPrisma = {
    cafeSubmission: {
      findFirst: async () => {
        reads += 1;
        return {
          id: 'submission-1',
          submissionType: 'owner',
          payload: { images: reads === 1 ? elevenImages : thirteenImages.slice(0, 12) },
        };
      },
    },
    $queryRaw: async () => {},
    $transaction: async (fn: any) => fn(racedPrisma),
  };
  const racedService = serviceFor(
    racedPrisma as any,
    {
      uploadImage: async () => 'raced.webp',
      deleteImage: async (url: string) => {
        deleted.push(url);
      },
    } as any,
  );
  await assert.rejects(
    () => racedService.uploadImages('user-1', 'submission-1', [{}] as any, 'images'),
    /Owner gallery allows at most 12 images/,
  );
  assert.deepEqual(deleted, ['raced.webp']);
});
