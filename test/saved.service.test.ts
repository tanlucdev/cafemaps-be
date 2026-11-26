import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SavedService } from '../src/saved/saved.service';

function createService(overrides: any = {}) {
  const prisma = {
    savedCollection: {
      findMany: async () => [],
      upsert: async (args: any) => args.create,
      deleteMany: async () => ({ count: 1 }),
    },
    savedCafe: {
      findMany: async () => [],
      findUnique: async () => ({ id: 'saved-1' }),
      update: async (args: any) => args.data,
      updateMany: async () => ({ count: 1 }),
    },
    cafe: {
      findFirst: async () => ({ id: 'cafe-1' }),
    },
    $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)),
    ...overrides.prisma,
  };

  return { service: new SavedService(prisma as any), prisma };
}

test('getCollections merges empty folders and folders used by saved cafes', async () => {
  const { service } = createService({
    prisma: {
      $queryRaw: async () => [
        { name: 'Dates', createdAt: new Date('2026-01-01') },
        { name: 'WORK', createdAt: new Date('2026-01-01') },
        { name: ' Work ', createdAt: null },
        { name: 'work', createdAt: null },
      ],
    },
  });

  assert.deepEqual(await service.getCollections('user-1'), [
    { name: 'Dates', createdAt: new Date('2026-01-01') },
    { name: 'Work' },
  ]);
});

test('saved cafes only expose visible published cafes', async () => {
  let where: any;
  const { service } = createService({
    prisma: {
      savedCafe: {
        findMany: async (args: any) => {
          where = args.where;
          return [];
        },
      },
    },
  });

  await service.getSaved('user-1');
  assert.deepEqual(where, {
    userId: 'user-1',
    cafe: { isPublished: true, isHidden: false },
  });
});

test('deleteCollection clears saved cafes then removes empty folder', async () => {
  const calls: string[] = [];
  const { service } = createService({
    prisma: {
      savedCafe: {
        updateMany: async (args: any) => {
          calls.push(`cafes:${args.where.collectionName}:${args.data.collectionName}`);
          return { count: 2 };
        },
      },
      savedCollection: {
        deleteMany: async (args: any) => {
          calls.push(`folder:${args.where.name}`);
          return { count: 1 };
        },
      },
    },
  });

  assert.deepEqual(await service.deleteCollection('user-1', 'Dates'), { deleted: true });
  assert.deepEqual(calls, ['cafes:Dates:null', 'folder:Dates']);
});

test('moveToCollection accepts null to move a cafe back to All', async () => {
  const calls: string[] = [];
  const { service } = createService({
    prisma: {
      savedCollection: {
        upsert: async () => {
          calls.push('folder:upsert');
        },
      },
      savedCafe: {
        findUnique: async () => ({ id: 'saved-1' }),
        update: async (args: any) => {
          calls.push(`cafe:${args.data.collectionName}`);
          return args.data;
        },
      },
    },
  });

  assert.deepEqual(await service.moveToCollection('user-1', 'cafe-1', null), {
    collectionName: null,
  });
  assert.deepEqual(calls, ['cafe:null']);
});
