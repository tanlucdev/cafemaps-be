import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { serviceFor } from './submissions.fixture';
test('create stores detail draft payload', async () => {
  let createArgs: any;
  const prisma = {
    cafeSubmission: {
      create: async (args: any) => {
        createArgs = args;
        return { id: 'submission-1', ...args.data };
      },
    },
  };
  const service = serviceFor(prisma as any, {} as any);

  await service.create('user-1', {
    name: 'Cafe Draft',
    payload: { name: 'Cafe Draft', images: ['https://img.test/1.webp'] },
  });

  assert.deepEqual(createArgs.data.payload, {
    name: 'Cafe Draft',
    images: ['https://img.test/1.webp'],
  });
  assert.equal(createArgs.data.submissionType, 'community');
  assert.equal(createArgs.data.status, 'pending');
});

test('create stores owner submission type', async () => {
  let createArgs: any;
  const prisma = {
    cafeSubmission: {
      create: async (args: any) => {
        createArgs = args;
        return { id: 'submission-1', ...args.data };
      },
    },
  };
  const service = serviceFor(prisma as any, {} as any);

  await service.create('user-1', {
    name: 'Owner Cafe',
    submissionType: 'owner',
    payload: { ownerName: 'Anh Chủ' },
  });

  assert.equal(createArgs.data.submissionType, 'owner');
  assert.equal(createArgs.data.status, 'draft');
  assert.deepEqual(createArgs.data.payload, { ownerName: 'Anh Chủ' });
});

test('update preserves owner contribution payload fields', async () => {
  let findFirstArgs: any;
  let updateArgs: any;
  const payload = {
    parkingLocation: 'Hầm B1',
    signatureDrink: 'Cold brew',
    instagramUrl: 'https://instagram.com/cafe',
    ownerName: 'Anh Chủ',
    ownerPhone: '0900000000',
    ownerEmail: 'owner@test.dev',
    ownerRole: 'Chủ quán',
    ownerProofNote: 'Có giấy phép kinh doanh',
    openingTime: '07:00',
    closingTime: '22:00',
    priceMin: 45000,
    priceMax: 90000,
    menuImages: ['menu.webp'],
  };
  const prisma = {
    cafeSubmission: {
      findFirst: async (args: any) => {
        findFirstArgs = args;
        return { id: 'submission-1', submissionType: 'owner', payload };
      },
      update: async (args: any) => {
        updateArgs = args;
        return { id: args.where.id, ...args.data };
      },
    },
  };
  const service = serviceFor(prisma as any, {} as any);

  await service.update('user-1', 'submission-1', { name: 'Owner Cafe', payload });

  assert.deepEqual(updateArgs.data.payload, {
    ...payload,
    images: [],
    imageOrientations: [],
    coverImage: null,
    coverImageCrop: null,
  });
  assert.deepEqual(findFirstArgs.where, {
    id: 'submission-1',
    submittedById: 'user-1',
    status: 'draft',
    isHidden: false,
  });
  assert.equal(updateArgs.data.submissionType, 'owner');
});

test('uploadImage only updates submitter-owned draft payload', async () => {
  let updateArgs: any;
  let uploadedFile: any;
  let lockQuery: any;
  const findFirstCalls: any[] = [];
  const prisma = {
    cafeSubmission: {
      findFirst: async (args: any) => {
        findFirstCalls.push(args);
        return args.where.submittedById === 'user-1'
          ? { id: 'submission-1', payload: { images: ['old.webp'] } }
          : null;
      },
      update: async (args: any) => {
        updateArgs = args;
        return { id: args.where.id, ...args.data };
      },
    },
    $queryRaw: async (query: any) => {
      lockQuery = query;
    },
    $transaction: async (fn: any) => fn(prisma),
  };
  const storage = {
    uploadImage: async (file: any) => {
      uploadedFile = file;
      return 'new.webp';
    },
  };
  const service = serviceFor(prisma as any, storage as any);
  const heicFile = { originalname: 'owner.HEIC', mimetype: '', buffer: Buffer.from('heic') };

  await assert.rejects(
    () => service.uploadImage('user-2', 'submission-1', {} as any, 'images'),
    /Submission not found/,
  );
  await service.uploadImage('user-1', 'submission-1', heicFile as any, 'images');

  assert.equal(uploadedFile, heicFile);
  assert.equal(findFirstCalls[1].where.status, 'draft');
  assert.match(lockQuery.strings.join('?'), /CAST\(\? AS uuid\)/);
  assert.deepEqual(updateArgs.data.payload.images, ['old.webp', 'new.webp']);
  assert.deepEqual(updateArgs.data.payload.imageOrientations, ['unknown', 'unknown']);
  assert.equal(updateArgs.data.payload.coverImage, 'old.webp');
});

test('uploadImages preserves selected file order', async () => {
  let updateArgs: any;
  const uploaded: string[] = [];
  const prisma = {
    cafeSubmission: {
      findFirst: async () => ({
        id: 'submission-1',
        payload: { images: ['old.webp'], imageOrientations: ['landscape'] },
      }),
      update: async (args: any) => {
        updateArgs = args;
        return { id: args.where.id, ...args.data };
      },
    },
    $queryRaw: async () => {},
    $transaction: async (fn: any) => fn(prisma),
  };
  const storage = {
    uploadImage: async (file: any) => {
      uploaded.push(file.originalname);
      return `${file.originalname}.webp`;
    },
  };
  const service = serviceFor(prisma as any, storage as any);

  await service.uploadImages(
    'user-1',
    'submission-1',
    [{ originalname: 'first' }, { originalname: 'second' }] as any,
    'images',
  );

  assert.deepEqual(uploaded, ['first', 'second']);
  assert.deepEqual(updateArgs.data.payload.images, ['old.webp', 'first.webp', 'second.webp']);
  assert.deepEqual(updateArgs.data.payload.imageOrientations, ['landscape', 'unknown', 'unknown']);
});

test('uploadImages appends menuImages in selected order', async () => {
  let updateArgs: any;
  const prisma = {
    cafeSubmission: {
      findFirst: async () => ({ id: 'submission-1', payload: { menuImages: ['old-menu.webp'] } }),
      update: async (args: any) => {
        updateArgs = args;
        return { id: args.where.id, ...args.data };
      },
    },
    $queryRaw: async () => {},
    $transaction: async (fn: any) => fn(prisma),
  };
  const storage = {
    uploadImage: async (file: any) => `${file.originalname}.webp`,
  };
  const service = serviceFor(prisma as any, storage as any);

  await service.uploadImages(
    'user-1',
    'submission-1',
    [{ originalname: 'menu-1' }, { originalname: 'menu-2' }] as any,
    'menuImages',
  );

  assert.deepEqual(updateArgs.data.payload.menuImages, [
    'old-menu.webp',
    'menu-1.webp',
    'menu-2.webp',
  ]);
});

test('uploadImages merges into latest payload inside transaction', async () => {
  let findFirstCount = 0;
  let updateArgs: any;
  const prisma = {
    cafeSubmission: {
      findFirst: async () => {
        findFirstCount += 1;
        return {
          id: 'submission-1',
          payload:
            findFirstCount === 1
              ? { images: ['old.webp'] }
              : {
                  images: ['old.webp', 'fresh.webp'],
                  imageOrientations: ['landscape', 'portrait'],
                },
        };
      },
      update: async (args: any) => {
        updateArgs = args;
        return { id: args.where.id, ...args.data };
      },
    },
    $queryRaw: async () => {},
    $transaction: async (fn: any) => fn(prisma),
  };
  const storage = { uploadImage: async (file: any) => `${file.originalname}.webp` };
  const service = serviceFor(prisma as any, storage as any);

  await service.uploadImages('user-1', 'submission-1', [{ originalname: 'new' }] as any, 'images');

  assert.deepEqual(updateArgs.data.payload.images, ['old.webp', 'fresh.webp', 'new.webp']);
  assert.deepEqual(updateArgs.data.payload.imageOrientations, ['landscape', 'portrait', 'unknown']);
});

test('uploadImages deletes already uploaded files when later upload fails', async () => {
  const deleted: string[] = [];
  const prisma = {
    cafeSubmission: {
      findFirst: async () => ({ id: 'submission-1', payload: {} }),
    },
  };
  const storage = {
    uploadImage: async (file: any) => {
      if (file.originalname === 'bad') throw new Error('upload failed');
      return `${file.originalname}.webp`;
    },
    deleteImage: async (url: string) => {
      deleted.push(url);
    },
  };
  const service = serviceFor(prisma as any, storage as any);

  await assert.rejects(
    () =>
      service.uploadImages(
        'user-1',
        'submission-1',
        [{ originalname: 'ok' }, { originalname: 'bad' }] as any,
        'images',
      ),
    /upload failed/,
  );
  assert.deepEqual(deleted, ['ok.webp']);
});
