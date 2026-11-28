import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';
import { CafesService } from '../src/cafes/cafes.service';
import { serializeLocalizedCafe } from '../src/cafes/cafe.mapper';
import { cafeListSelect } from '../src/cafes/cafes.helpers';
import { CafeFilterDto } from '../src/cafes/dto/cafe-filter.dto';

function createService(overrides: any = {}) {
  const prisma = {
    cafe: {
      findMany: async () => [],
      count: async () => 0,
    },
    cafeVote: {
      groupBy: async () => [],
    },
    ...overrides.prisma,
  };
  const routeDistance = {
    getRouteDistances: async () => null,
    ...overrides.routeDistance,
  };

  return {
    service: new CafesService(prisma as any, routeDistance as any),
    prisma,
    routeDistance,
  };
}

test('public cafe detail includes the original post URLs', async () => {
  const experienceUrls = ['https://www.instagram.com/p/source/'];
  const { service } = createService({
    prisma: {
      cafe: {
        findFirst: async () => ({ id: 'source-cafe', experienceUrls }),
      },
    },
  });

  const cafe = await service.findBySlug('source-cafe');
  assert.ok('experienceUrls' in cafe);
  assert.deepEqual(cafe.experienceUrls, experienceUrls);
  assert.equal('experienceUrls' in cafeListSelect, false);
});

test('sitemap returns slugs and districts beyond the guest preview', async () => {
  const cafes = Array.from({ length: 20 }, (_, index) => ({
    slug: `cafe-${index}`,
    district: index % 2 ? 'Quận 1' : null,
  }));
  const { service } = createService({
    prisma: {
      cafe: {
        findMany: async (query: Prisma.CafeFindManyArgs) => {
          assert.deepEqual(query, {
            where: { isPublished: true, isHidden: false },
            select: { slug: true, district: true },
            orderBy: { slug: 'asc' },
          });
          return cafes;
        },
      },
    },
  });

  assert.deepEqual(await service.getSitemapEntries(), cafes);
});

test('serializeLocalizedCafe dedupes localized list values case-insensitively', () => {
  const cafe = serializeLocalizedCafe(
    {
      amenities: ['wifi', 'ổ cắm', 'điều hoà', 'WiFi', 'Chỗ đậu xe', 'Ổ cắm'],
      amenitiesEn: [],
      tags: ['Ngoài trời', 'ngoài trời'],
      tagsEn: [],
    },
    'vi',
  );

  assert.deepEqual(cafe.amenities, ['wifi', 'ổ cắm', 'điều hoà', 'Chỗ đậu xe']);
  assert.deepEqual(cafe.tags, ['Ngoài trời']);
});

test('CafeFilterDto accepts normalized districts and keeps legacy district', () => {
  const dto = plainToInstance(CafeFilterDto, {
    districts: ' Quận 1,Quận 3,,Quận 1 , Quận 3 ',
    district: 'Quận 2',
  });

  assert.deepEqual(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }), []);
  assert.deepEqual(dto.districts, ['Quận 1', 'Quận 3']);
  assert.equal(dto.district, 'Quận 2');
});

test('findAll uses districts before legacy district for exact matching, count, sorting, and pagination', async () => {
  const findManyCalls: any[] = [];
  const countCalls: any[] = [];
  const { service } = createService({
    prisma: {
      cafe: {
        findMany: async (args: any) => {
          findManyCalls.push(args);
          return [{ id: 'cafe-1', _count: { savedCafes: 0 } }];
        },
        count: async (args: any) => {
          countCalls.push(args);
          return 3;
        },
      },
    },
  });

  const result = await service.findAll(
    {
      districts: ['Quận 1', 'Quận 3'],
      district: 'Quận 2',
      sort: 'newest',
      page: 2,
      limit: 1,
    },
  );
  const where = {
    isPublished: true,
    isHidden: false,
    AND: [
      {
        OR: [
          { district: { in: ['Quận 1', 'Quận 3'] } },
          { districtEn: { in: ['Quận 1', 'Quận 3'] } },
        ],
      },
    ],
  };

  assert.deepEqual(findManyCalls[0].where, where);
  assert.deepEqual(countCalls[0], { where });
  assert.equal(findManyCalls[0].skip, 1);
  assert.equal(findManyCalls[0].take, 1);
  assert.deepEqual(findManyCalls[0].orderBy, [{ createdAt: 'desc' }]);
  assert.deepEqual(result.meta, { total: 3, page: 2, limit: 1, totalPages: 3 });
});

test('findAll keeps legacy district as a one-item exact-match list', async () => {
  let findManyArgs: any;
  const { service } = createService({
    prisma: {
      cafe: {
        findMany: async (args: any) => {
          findManyArgs = args;
          return [];
        },
        count: async () => 0,
      },
    },
  });

  await service.findAll({ district: 'Quận 1', sort: 'rating' });

  assert.deepEqual(findManyArgs.where.AND, [
    { OR: [{ district: { in: ['Quận 1'] } }, { districtEn: { in: ['Quận 1'] } }] },
  ]);
});

test('popular filters matched cafes before counting and ranking', async () => {
  const calls: Prisma.Sql[] = [];
  const { service } = createService({
    prisma: {
      $queryRaw: async (query: Prisma.Sql) => {
        calls.push(query);
        return [{ total: 0, id: null }];
      },
    },
  });

  const result = await service.findAll({
    district: 'Quận 2',
    districts: ['Quận 1'],
    search: 'quiet',
    vibes: ['Quiet'],
    purposes: ['Work'],
    tags: ['Outdoor'],
    priceRange: 'price_50k_100k',
    chainId: '00000000-0000-0000-0000-000000000001',
    hours: 'open_24h',
    openNow: true,
  });

  assert.equal(calls.length, 1);
  const { sql, values } = calls[0];
  const matched = sql.split('SELECT totals.total')[0];
  assert.match(matched, /c\.is_published = true AND c\.is_hidden = false/);
  assert.match(matched, /c\.district IN \(\?\) OR c\.district_en IN \(\?\)/);
  assert.equal((matched.match(/ILIKE \?/g) ?? []).length, 6);
  for (const column of ['vibes', 'purposes', 'tags']) {
    assert.ok(matched.includes(`c.${column} &&`));
    assert.ok(matched.includes(`c.${column}_en &&`));
  }
  assert.match(matched, /c\.price_min >= 50000 AND c\.price_max <= 100000/);
  assert.match(matched, /c\.chain_id = \?::uuid/);
  assert.match(matched, /c\.opening_time = c\.closing_time/);
  assert.match(matched, /c\.opening_time <= \?::time AND c\.closing_time > \?::time/);
  assert.match(sql, /COUNT\(\*\)::int AS total FROM matched/);
  assert.deepEqual(values.slice(0, 14), [
    'Quận 1', 'Quận 1', ...Array(6).fill('%quiet%'),
    'Quiet', 'Quiet', 'Work', 'Work', 'Outdoor', 'Outdoor',
  ]);
  assert.equal(result.meta.total, 0);
});

test('findAll passes rating sort to Prisma before pagination', async () => {
  let findManyArgs: any;
  const { service } = createService({
    prisma: {
      cafe: {
        findMany: async (args: any) => {
          findManyArgs = args;
          return [{ id: 'cafe-1', _count: { savedCafes: 3, cafeVotes: 4 } }];
        },
        count: async () => 1,
      },
      cafeVote: {
        groupBy: async ({ where }: any) =>
          where.createdAt ? [] : [{ cafeId: 'cafe-1', _count: { cafeId: 4 } }],
      },
    },
  });

  const result = await service.findAll({ sort: 'rating', page: 2, limit: 9 });

  assert.equal(findManyArgs.skip, 9);
  assert.equal(findManyArgs.take, 9);
  assert.deepEqual(findManyArgs.orderBy[0], { rating: { sort: 'desc', nulls: 'last' } });
  assert.equal(findManyArgs.select.rating, true);
  assert.deepEqual(result.data, [
    { id: 'cafe-1', savedCount: 3, viewCount: 0, voteCount: 4, weeklyVoteCount: 0 },
  ]);
  assert.deepEqual(result.meta, { total: 1, page: 2, limit: 9, totalPages: 1 });
});

test('guest discovery returns public previews and pagination', async () => {
  const queries: any[] = [];
  const { service } = createService({
    prisma: {
      $queryRaw: async (query: any) => {
        queries.push(query);
        return queries.length === 1
          ? [{ total: 18n }]
          : Array.from({ length: 9 }, (_, index) => ({
              id: String(index),
              _count: { savedCafes: 0 },
            }));
      },
    },
  });
  const guest = await service.findNearbyDiscovery({ lat: 10.77, lng: 106.7, limit: 9 });

  assert.equal(queries.length, 2);
  assert.equal(guest.data.length, 9);
  assert.deepEqual(guest.meta, { total: 18, page: 1, limit: 9, totalPages: 2 });
});

test('guest list returns every page of filtered previews', async () => {
  const cafes = Array.from({ length: 27 }, (_, index) => ({
    id: String(index),
    _count: { savedCafes: 0 },
  }));
  const { service } = createService({
    prisma: {
      cafe: {
        findMany: async ({ skip = 0, take = cafes.length }: { skip?: number; take?: number }) =>
          cafes.slice(skip, skip + take),
        count: async () => cafes.length,
      },
    },
  });

  const firstPage = await service.findAll({ search: 'coffee', sort: 'rating', limit: 9 });
  const secondPage = await service.findAll({ search: 'coffee', sort: 'rating', page: 2, limit: 9 });
  const thirdPage = await service.findAll({ search: 'coffee', sort: 'rating', page: 3, limit: 9 });

  assert.deepEqual([firstPage, secondPage, thirdPage].map(({ data }) => data.length), [9, 9, 9]);
  assert.deepEqual(thirdPage.meta, { total: 27, page: 3, limit: 9, totalPages: 3 });
});

test('opening hours filter contract accepts legacy input, filters both modes, rejects invalid input', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const legacy = await pipe.transform(
    { hours: 'from_7' },
    { type: 'query', metatype: CafeFilterDto },
  );
  await assert.rejects(
    () => pipe.transform({ hours: 'invalid' }, { type: 'query', metatype: CafeFilterDto }),
    (error: any) => error.getStatus?.() === 400,
  );

  const queries: any[] = [];
  const { service } = createService({
    prisma: {
      cafe: {
        fields: { closingTime: 'closingTime' },
        findMany: async (args: any) => {
          queries.push(args);
          return [];
        },
        count: async () => 0,
      },
    },
  });
  await service.findAll({ hours: legacy.hours, sort: 'rating' });
  await service.findAll({ hours: 'open_24h', sort: 'rating' });

  assert.deepEqual(
    queries.map((query) => query.where.AND),
    [
      [{ openingTime: { equals: new Date('1970-01-01T07:00:00.000Z') } }],
      [{ openingTime: { equals: 'closingTime' } }],
    ],
  );
});

test('popular fetches only page IDs and preserves SQL order and counts', async () => {
  const rows = [
    { id: 'weekly', total: 5, weeklyVoteCount: 3, voteCount: 4 },
    { id: 'all-time', total: 5, weeklyVoteCount: 0, voteCount: 8 },
    { id: 'a', total: 5, weeklyVoteCount: 0, voteCount: 0 },
    { id: 'b', total: 5, weeklyVoteCount: 0, voteCount: 0 },
    { id: 'c', total: 5, weeklyVoteCount: 0, voteCount: 0 },
  ];
  const queries: Prisma.Sql[] = [];
  const findManyCalls: unknown[] = [];
  const { service } = createService({
    prisma: {
      $queryRaw: async (query: Prisma.Sql) => {
        queries.push(query);
        const [limit, offset] = query.values.slice(-2) as number[];
        const page = rows.slice(offset, offset + limit);
        return page.length ? page : [{ id: null, total: rows.length }];
      },
      cafe: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          findManyCalls.push(args);
          return [...args.where.id.in].reverse().map((id) => ({ id }));
        },
      },
    },
  });

  const first = await service.findAll({ limit: 2 });
  const second = await service.findAll({ sort: 'popular', page: 2, limit: 2 });
  const empty = await service.findAll({ page: 4, limit: 2 });

  assert.deepEqual(
    first.data.map(({ id, weeklyVoteCount, voteCount }) => [id, weeklyVoteCount, voteCount]),
    [['weekly', 3, 4], ['all-time', 0, 8]],
  );
  assert.deepEqual(second.data.map(({ id }) => id), ['a', 'b']);
  assert.deepEqual(empty, { data: [], meta: { total: 5, page: 4, limit: 2, totalPages: 3 } });
  assert.deepEqual(queries.map(({ values }) => values.slice(-2)), [[2, 0], [2, 2], [2, 6]]);
  assert.match(
    queries[0].sql.replace(/\s+/g, ' '),
    /ORDER BY view_count DESC, weekly_vote_count DESC, vote_count DESC, COALESCE\(is_featured, false\) DESC, featured_order ASC NULLS LAST, saved_count DESC, created_at DESC, id ASC LIMIT \? OFFSET \?/,
  );
  assert.deepEqual(findManyCalls, [['weekly', 'all-time'], ['a', 'b']].map((ids) => ({
    where: { id: { in: ids }, isPublished: true, isHidden: false },
    select: cafeListSelect,
  })));
});

test('popular guest pages hydrate the full public page', async () => {
  const queryBounds: unknown[][] = [];
  const detailSizes: number[] = [];
  const { service } = createService({
    prisma: {
      $queryRaw: async ({ values }: Prisma.Sql) => {
        const [limit, offset] = values.slice(-2) as number[];
        queryBounds.push([limit, offset]);
        return limit ? Array.from({ length: limit }, (_, index) => ({
          id: String(offset + index), total: 27, weeklyVoteCount: 0, voteCount: 0,
        })) : [{ id: null, total: 27 }];
      },
      cafe: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
          detailSizes.push(where.id.in.length);
          return where.id.in.map((id) => ({ id }));
        },
      },
    },
  });

  const first = await service.findAll({ page: 1, limit: 9 });
  const second = await service.findAll({ page: 2, limit: 9 });
  const third = await service.findAll({ page: 3, limit: 9 });

  assert.deepEqual(queryBounds, [[9, 0], [9, 9], [9, 18]]);
  assert.deepEqual(detailSizes, [9, 9, 9]);
  assert.deepEqual([first.data.length, second.data.length, third.data.length], [9, 9, 9]);
  assert.deepEqual([first, second, third].map(({ meta }) => meta.total), [27, 27, 27]);
});

test('findAll localizes cafe fields and searches both languages', async () => {
  let findManyArgs: any;
  const { service } = createService({
    prisma: {
      cafe: {
        findMany: async (args: any) => {
          findManyArgs = args;
          return [
            {
              id: 'cafe-1',
              name: 'Cà Phê Sáng',
              nameEn: 'Morning Coffee',
              address: 'Quận 1',
              addressEn: 'District 1',
              oneLiner: 'Yên tĩnh',
              oneLinerEn: 'Quiet spot',
              vibes: ['Yên tĩnh'],
              vibesEn: ['Quiet'],
              purposes: ['Làm việc'],
              purposesEn: ['Work'],
              amenities: ['Ổ cắm'],
              amenitiesEn: ['Power outlets'],
              tags: ['ngoài trời'],
              tagsEn: ['Outdoor'],
              _count: { savedCafes: 2, cafeVotes: 5 },
            },
          ];
        },
        count: async () => 1,
      },
      cafeVote: {
        groupBy: async ({ where }: any) =>
          where.createdAt ? [] : [{ cafeId: 'cafe-1', _count: { cafeId: 5 } }],
      },
    },
  });

  const result = await service.findAll({
    sort: 'rating',
    locale: 'en',
    search: 'quiet',
    vibes: ['Quiet'],
    purposes: ['Work'],
    tags: ['Outdoor'],
  });

  assert.equal(findManyArgs.where.AND[0].OR.length, 6);
  assert.deepEqual(findManyArgs.where.AND[1], {
    OR: [{ vibes: { hasSome: ['Quiet'] } }, { vibesEn: { hasSome: ['Quiet'] } }],
  });
  assert.deepEqual(findManyArgs.where.AND[2], {
    OR: [{ purposes: { hasSome: ['Work'] } }, { purposesEn: { hasSome: ['Work'] } }],
  });
  assert.deepEqual(findManyArgs.where.AND[3], {
    OR: [{ tags: { hasSome: ['Outdoor'] } }, { tagsEn: { hasSome: ['Outdoor'] } }],
  });
  assert.equal(findManyArgs.select.vibesEn, true);
  assert.equal(findManyArgs.select.purposesEn, true);
  assert.equal(findManyArgs.select.amenities, true);
  assert.equal(findManyArgs.select.amenitiesEn, true);
  assert.equal(findManyArgs.select.tags, true);
  assert.equal(findManyArgs.select.tagsEn, true);
  assert.deepEqual(result.data, [
    {
      id: 'cafe-1',
      name: 'Morning Coffee',
      address: 'District 1',
      oneLiner: 'Quiet spot',
      vibes: ['Quiet'],
      purposes: ['Work'],
      amenities: ['Power outlets'],
      tags: ['Outdoor'],
      savedCount: 2,
      viewCount: 0,
      voteCount: 5,
      weeklyVoteCount: 0,
    },
  ]);
});

test('findAll still returns cafes when vote table is missing', async () => {
  const { service } = createService({
    prisma: {
      cafe: {
        findMany: async () => [
          {
            id: 'cafe-1',
            createdAt: new Date('2026-01-01'),
            _count: { savedCafes: 2 },
          },
        ],
        count: async () => 1,
      },
      cafeVote: {
        groupBy: async () => {
          throw new Error('relation "cafe_votes" does not exist');
        },
      },
    },
  });

  const result = await service.findAll({ sort: 'rating' });

  assert.deepEqual(result.data, [
    {
      id: 'cafe-1',
      createdAt: new Date('2026-01-01'),
      savedCount: 2,
      viewCount: 0,
      voteCount: 0,
      weeklyVoteCount: 0,
    },
  ]);
});

test('trackView increments once per cafe visitor bucket', async () => {
  let viewCount = 0;
  const events: any[] = [];
  const { service } = createService({
    prisma: {
      cafe: {
        findFirst: async ({ where }: any) =>
          where.id === 'cafe-1' && where.isPublished ? { id: 'cafe-1', viewCount } : null,
        findUnique: async () => ({ viewCount }),
        update: async () => ({ viewCount: ++viewCount }),
      },
      cafeViewEvent: {
        create: async ({ data }: any) => {
          if (
            events.some(
              (event) =>
                event.cafeId === data.cafeId &&
                event.visitorKeyHash === data.visitorKeyHash &&
                event.bucketStart.getTime() === data.bucketStart.getTime(),
            )
          ) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'test',
            } as any);
          }
          events.push(data);
        },
      },
      $transaction: async (fn: any) =>
        fn({
          cafe: {
            update: async () => ({ viewCount: ++viewCount }),
          },
          cafeViewEvent: {
            create: async ({ data }: any) => {
              if (
                events.some(
                  (event) =>
                    event.cafeId === data.cafeId &&
                    event.visitorKeyHash === data.visitorKeyHash &&
                    event.bucketStart.getTime() === data.bucketStart.getTime(),
                )
              ) {
                throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                  code: 'P2002',
                  clientVersion: 'test',
                } as any);
              }
              events.push(data);
            },
          },
        }),
    },
  });

  assert.deepEqual(await service.trackView('cafe-1', 'visitor-1'), {
    viewCount: 1,
    counted: true,
  });
  assert.deepEqual(await service.trackView('cafe-1', 'visitor-1'), {
    viewCount: 1,
    counted: false,
  });
  assert.deepEqual(await service.trackView('cafe-1', 'visitor-2'), {
    viewCount: 2,
    counted: true,
  });
});

test('trackView returns 404 when cafe is missing or unpublished', async () => {
  const { service } = createService({
    prisma: {
      cafe: {
        findFirst: async () => null,
      },
    },
  });

  await assert.rejects(() => service.trackView('missing', 'visitor-1'), /Cafe not found/);
});

test('quizMatch defaults to a 36-cafe pool and keeps quiz filters', async () => {
  let findManyArgs: any;
  const { service } = createService({
    prisma: {
      cafe: {
        findMany: async (args: any) => {
          findManyArgs = args;
          return [];
        },
      },
    },
  });

  await service.quizMatch(['Minimalist'], ['Work'], 'en', ['Outdoor']);

  assert.equal(findManyArgs.take, 36);
  assert.deepEqual(findManyArgs.where.AND, [
    { OR: [{ vibes: { hasSome: ['Minimalist'] } }, { vibesEn: { hasSome: ['Minimalist'] } }] },
    { OR: [{ purposes: { hasSome: ['Work'] } }, { purposesEn: { hasSome: ['Work'] } }] },
    { OR: [{ tags: { hasSome: ['Outdoor'] } }, { tagsEn: { hasSome: ['Outdoor'] } }] },
  ]);
  assert.deepEqual(findManyArgs.orderBy, [{ isFeatured: 'desc' }, { featuredOrder: 'asc' }]);
});

test('quizMatch clamps limit between 1 and 50', async () => {
  const calls: any[] = [];
  const { service } = createService({
    prisma: {
      cafe: {
        findMany: async (args: any) => {
          calls.push(args);
          return [];
        },
      },
    },
  });

  await service.quizMatch([], [], undefined, [], 10);
  await service.quizMatch([], [], undefined, [], '999');
  await service.quizMatch([], [], undefined, [], '0');
  await service.quizMatch([], [], undefined, [], '-4');

  assert.deepEqual(
    calls.map((args) => args.take),
    [10, 50, 1, 1],
  );
});
