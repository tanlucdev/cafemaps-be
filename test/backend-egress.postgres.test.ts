import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';

const api = process.env.MEETUP_TEST_API_URL;
const baseline = process.env.EGRESS_TEST_BASELINE_URL;
const database = process.env.MEETUP_TEST_DATABASE_URL;
const secret = process.env.MEETUP_TEST_JWT_SECRET;

test('egress-sensitive HTTP responses on PostgreSQL/PostGIS', { skip: !api || !database || !secret }, async () => {
  for (const url of [api, database, baseline]) {
    if (url) assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname));
  }
  const prisma = new PrismaClient({ datasourceUrl: database });
  const run = `egress-${randomUUID().slice(0, 8)}`;
  const district = `Quận ${run}`;
  const slug = (n: number) => `${run}-${n}`;
  const idPrefix = randomUUID().slice(0, 24);
  const id = (n: number) => idPrefix + String(n).padStart(12, '0');
  const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const startsAt = new Date(`${date}T12:00:00+07:00`);
  const endsAt = new Date(`${date}T14:00:00+07:00`);
  let token: string;

  async function read(base: string, route: string, access?: string) {
    const res = await fetch(base + route, { headers: access ? { Authorization: `Bearer ${access}` } : {} });
    const body = await res.json();
    if (!res.ok) delete body.timestamp;
    return { status: res.status, cache: res.headers.get('cache-control'), body };
  }

  async function checked(route: string, options: { access?: string; compare?: boolean; status?: number } = {}) {
    const { access, compare = true, status = 200 } = options;
    const current = await read(api!, route, access);
    assert.equal(current.status, status, `${route}: ${JSON.stringify(current.body)}`);
    if (baseline && compare) {
      assert.deepEqual(current, await read(baseline, route, access), route);
    }
    return current.body;
  }

  try {
    const chain = await prisma.chain.create({ data: { name: run, slug: run } });
    const [host, pending, accepted] = await Promise.all(
      ['host', 'pending', 'accepted'].map((label) =>
        prisma.user.create({ data: { email: `${run}-${label}@example.test`, displayName: label } }),
      ),
    );
    const jwt = new JwtService({ secret });
    token = jwt.sign({ sub: host.id, role: host.role });

    await prisma.cafe.createMany({ data: Array.from({ length: 24 }, (_, index) => {
      const n = 24 - index;
      const common = {
        id: id(n), slug: slug(n), name: `QA Coffee ${slug(n)}`, nameEn: `QA Café ${slug(n)}`,
        district, createdAt: new Date(Date.UTC(2026, 0, n)), rating: '4.25',
        vibes: [`Yên tĩnh ${run}`], vibesEn: [] as string[], purposes: ['HỌC TẬP'],
        priceMin: 10_000, priceMax: 20_000,
      };
      switch (n) {
        case 1: return { ...common, districtEn: '', vibesEn: [`ĐẸP ${run}`, 'Quiet'], purposesEn: ['Work'] };
        case 2: return { ...common, districtEn: `District ${run}`, chainId: chain.id, vibesEn: [`\u00a0đẸp ${run}\ufeff`, ' QUIET '], purposesEn: [' work '] };
        case 3: return { ...common, districtEn: `Later ${run}`, chainId: chain.id, vibesEn: [`ĐẸP ${run}`, 'Quiet'], purposesEn: ['Work'] };
        case 4: return { ...common, vibes: [], vibesEn: [`ĐẸP ${run}`, 'Quiet', `YÊN TĨNH ${run}`], purposes: [' học tập '], purposesEn: ['Work'], priceMin: 20_000, priceMax: 30_000 };
        case 5: return { ...common, vibesEn: [`DEP ${run}`, 'Quiet'], purposesEn: ['Work'] };
        case 6: return { ...common, vibesEn: [`ĐẸP ${run}`, 'Quiet'], purposesEn: ['Work'], priceMin: null };
        case 7: return { ...common, vibesEn: [`ĐẸP ${run}`, 'Quiet'], purposesEn: ['Study'] };
        case 8: return { ...common, vibes: [`yên tĩnh ${run}`], vibesEn: ['quiet', `đẹp ${run}`] };
        case 9: return { ...common, isHidden: true, vibesEn: [`ĐẸP ${run}`, 'Quiet'] };
        case 10: return { ...common, vibes: [' '], vibesEn: [] };
        case 11: return { ...common, vibes: [' '], vibesEn: [] };
        case 12: return { ...common, district: `Phường ${run}` };
        default: return common;
      }
    }) });
    await prisma.$executeRaw`
      UPDATE cafes SET location = ST_Project(
        ST_SetSRID(ST_MakePoint(106.7, 10.77), 4326)::geography,
        CASE id WHEN ${id(1)}::uuid THEN 1999 WHEN ${id(2)}::uuid THEN 1998 ELSE 2001 END,
        0
      ) WHERE id IN (${id(1)}::uuid, ${id(2)}::uuid, ${id(3)}::uuid)
    `;
    const meetup = (n: number, cafe: number | null, overrides: object = {}) => ({
      id: id(100 + n), cafeId: cafe ? id(cafe) : null, organizerId: host.id,
      purpose: 'LÀM VIỆC', title: `QA Coffee ${run}`, startsAt, endsAt, maxParticipants: 4,
      ...overrides,
    });
    await prisma.coffeeMeetup.createMany({ data: [
      meetup(1, 1), meetup(2, 2), meetup(3, 3),
      meetup(4, 1, { status: 'full' }),
      meetup(5, 1, { purpose: 'study' }),
      meetup(6, 1, { isHidden: true }),
      meetup(7, null, { externalPlaceName: `QA Coffee ${run}` }),
      meetup(8, 1, { startsAt: new Date(startsAt.getTime() + 86_400_000), endsAt: new Date(endsAt.getTime() + 86_400_000) }),
      meetup(9, 2, { startsAt: new Date(startsAt.getTime() - 1000), title: 'Other meetup title' }),
      meetup(10, 1, { endsAt: new Date(0) }),
    ] });
    await prisma.coffeeMeetupRequest.createMany({ data: [
      { meetupId: id(101), requesterId: pending.id, status: 'pending', message: 'Private' },
      { meetupId: id(101), requesterId: accepted.id, status: 'accepted' },
    ] });
    await prisma.cafeVote.createMany({ data: [id(24), id(8), id(2)].map((cafeId) => ({ userId: host.id, cafeId })) });
    await prisma.savedCollection.createMany({ data: [run, 'Diverse', 'dIVERSE', 'WORK'].map((name) => ({ userId: host.id, name })) });

    const similar = await checked(`/cafes/${slug(1)}/similar?locale=en`);
    assert.deepEqual(similar.data.map(({ cafe }: any) => cafe.id), [2, 4, 6, 7].map(id));
    assert.equal(similar.data[0].matchedVibe, `yên tĩnh ${run}`);
    assert.equal(similar.data[1].matchedVibe, `đẹp ${run}`);
    assert.equal((await checked(`/cafes/${slug(10)}/similar?locale=en`)).data[0].matchedVibe, 'similar atmosphere');
    assert.equal((await checked(`/cafes/${slug(10)}/similar`)).data[0].matchedVibe, 'không gian tương đồng');
    await checked(`/cafes/${run}-missing/similar`, { status: 404 });
    const districts = await checked('/cafes/districts');
    assert.equal(districts.filter((name: string) => name === district).length, 1);
    const english = await checked('/cafes/districts?locale=en', { compare: false });
    assert(english.includes(`District ${run}`));
    assert(!english.includes(`Later ${run}`));
    assert(english.includes(`Phường ${run}`));

    const nearby = new URLSearchParams({
      nearMe: 'true', lat: '10.77', lng: '106.7', radiusKm: '2', available: 'true',
      purpose: 'work', search: run, area: district, date, limit: '2',
    });
    const listing = `/coffee-meetups?${nearby}`;
    const first = await checked(listing);
    assert.deepEqual(first.data.map(({ id, distanceKm }: any) => [id, distanceKm]), [[id(109), 2], [id(101), 2]]);
    assert.equal(first.meta.total, 3);
    assert.equal(first.data[1].pendingCount, 1);
    assert.equal(first.data[1].acceptedCount, 2);
    assert.deepEqual(first.data[1].requests, []);
    assert.equal((await checked(`${listing}&page=2`)).data[0].id, id(102));
    assert.deepEqual(await checked(`${listing}&page=3`), { data: [], meta: { total: 3, page: 3, limit: 2, totalPages: 2 } });
    assert.equal((await checked(`${listing}&cafeId=${id(3)}`)).meta.total, 3);
    nearby.set('search', `unmatched-${run}`);
    assert.equal((await checked(`/coffee-meetups?${nearby}`)).meta.total, 0);
    assert.equal((await checked(`/coffee-meetups/${id(101)}`)).pendingCount, 1);
    assert.equal((await checked(`/coffee-meetups/${id(101)}`, { access: token })).requests.length, 2);
    await checked(`/coffee-meetups?search=${run}`);

    for (const sort of ['rating', 'newest']) {
      for (const [index, size] of [9, 6, 0].entries()) {
        const route = `/cafes?sort=${sort}&search=${run}&page=${index + 1}&limit=9`;
        const guests = await checked(route);
        assert.equal(guests.data.length, size);
        assert.equal(guests.meta.total, 23);
        assert.equal(guests.meta.discovery.teaserSlots, [0, 3, 5][index]);
        assert(guests.data.every((cafe: any) => cafe.weeklyVoteCount === 0));
        if (!index) assert.equal(guests.data[0].voteCount, 1);
        await checked(route, { access: token });
      }
    }

    // All visible cafes now tie on the original sort fields.
    await prisma.cafe.updateMany({
      where: { slug: { startsWith: `${run}-` } },
      data: { createdAt: new Date('2026-01-01T00:00:00Z') },
    });
    const tiedIds = Array.from({ length: 24 }, (_, index) => index + 1)
      .filter((n) => n !== 9).map(id);
    for (const sort of ['rating', 'newest']) {
      for (const [index, size] of [9, 6, 0].entries()) {
        const route = `/cafes?sort=${sort}&search=${run}&page=${index + 1}&limit=9`;
        const pageIds = tiedIds.slice(index * 9, (index + 1) * 9);
        const member = await checked(route, { access: token, compare: false });
        const guest = await checked(route, { compare: false });
        assert.deepEqual(member.data.map((cafe: { id: string }) => cafe.id), pageIds);
        assert.deepEqual(guest.data.map((cafe: { id: string }) => cafe.id), pageIds.slice(0, size));
      }
    }

    const usedNames = [' Work ', 'work', '  ', 'Dates', 'Dates'];
    await prisma.savedCafe.createMany({ data: usedNames.map((collectionName, n) => ({ userId: host.id, cafeId: id(n + 1), collectionName })) });
    const collections = await checked('/saved/collections', { access: token, compare: false });
    const created = await prisma.savedCollection.findMany({
      where: { userId: host.id, name: { in: ['Diverse', 'dIVERSE', run] } },
      orderBy: { name: 'asc' },
    });
    const createdFirst = created.find(({ name }) => name.toLowerCase() === 'diverse')!;
    const emptyCollection = created.find(({ name }) => name === run)!;
    assert.deepEqual(collections, [
      { name: 'Dates' },
      { name: createdFirst.name, createdAt: createdFirst.createdAt.toISOString() },
      { name: run, createdAt: emptyCollection.createdAt.toISOString() },
      { name: 'Work' },
    ]);
    if (baseline) {
      const before = await read(baseline, '/saved/collections', token);
      assert.equal(before.status, 200);
      assert.deepEqual(before.body.map(({ name }: any) => name.toLowerCase()), collections.map(({ name }: any) => name.toLowerCase()));
    }
  } finally {
    await prisma.user.deleteMany({ where: { email: { startsWith: `${run}-` } } });
    await prisma.cafe.deleteMany({ where: { slug: { startsWith: `${run}-` } } });
    await prisma.chain.deleteMany({ where: { slug: run } });
    await prisma.$disconnect();
  }
});
