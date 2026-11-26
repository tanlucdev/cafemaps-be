import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CoffeeMeetupsService } from '../src/coffee-meetups/coffee-meetups.service';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCoffeeMeetupDto } from '../src/coffee-meetups/dto/coffee-meetup.dto';
import { normalizeGoogleMapsUrl, normalizePurpose } from '../src/coffee-meetups/coffee-meetups.helpers';

const future = (hours: number) => new Date(Date.now() + hours * 3_600_000);

function createPrisma() {
  const cafes = [{ id: 'cafe-1', isPublished: true, name: 'Cafe One', slug: 'cafe-one' }];
  const meetups: any[] = [];
  const requests: any[] = [];
  const reports: any[] = [];
  const withCounts = (meetup: any, include?: any) => ({
    ...meetup,
    cafe: cafes.find((cafe) => cafe.id === meetup.cafeId),
    organizer: { id: meetup.organizerId, email: `${meetup.organizerId}@example.com` },
    ...(include?.requests ? { requests: requests.filter((request) => request.meetupId === meetup.id).map((request) => ({ ...request, requester: { id: request.requesterId, email: `${request.requesterId}@example.com`, displayName: request.requesterId === 'user-1' ? 'Lan' : null } })) } : {}),
    ...(include?.reports ? { reports: reports.filter((report) => report.meetupId === meetup.id) } : {}),
    _count: {
      requests: requests.filter((request) => request.meetupId === meetup.id && request.status === 'accepted').length,
      reports: reports.filter((report) => report.meetupId === meetup.id).length,
    },
  });
  const matchesMeetup = (meetup: any, where: any) =>
    (!where.id || meetup.id === where.id) &&
    (where.isHidden === undefined || meetup.isHidden === where.isHidden) &&
    (!where.endsAt?.gt || meetup.endsAt > where.endsAt.gt) &&
    (!where.status?.in || where.status.in.includes(meetup.status));
  const prisma: any = {
    cafe: {
      findFirst: async ({ where }: any) =>
        cafes.find((cafe) => cafe.id === where.id && cafe.isPublished === where.isPublished) ?? null,
    },
    coffeeMeetup: {
      create: async ({ data }: any) => {
        const meetup = {
          id: `meetup-${meetups.length + 1}`,
          status: 'open',
          isHidden: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        meetups.push(meetup);
        return withCounts(meetup);
      },
      findMany: async ({ where }: any) => meetups.filter((meetup) => matchesMeetup(meetup, where)).map((meetup) => withCounts(meetup)),
      count: async ({ where }: any) => meetups.filter((meetup) => matchesMeetup(meetup, where)).length,
      findFirst: async ({ where, include }: any) => {
        const meetup = meetups.find((item) => matchesMeetup(item, where));
        return meetup ? withCounts(meetup, include) : null;
      },
      findUnique: async ({ where, include }: any) => {
        const meetup = meetups.find((item) => item.id === where.id);
        return meetup ? withCounts(meetup, include) : null;
      },
      findFirstOrThrow: async ({ where }: any) => {
        const meetup = meetups.find((item) => item.id === where.id && !item.isHidden);
        if (!meetup) throw new Error('not found');
        return meetup;
      },
      update: async ({ where, data }: any) => {
        const meetup = meetups.find((item) => item.id === where.id);
        Object.assign(meetup, data, { updatedAt: new Date() });
        return withCounts(meetup);
      },
    },
    coffeeMeetupRequest: {
      findUnique: async ({ where }: any) => {
        const request = where.id
          ? requests.find((item) => item.id === where.id)
          : requests.find((item) => item.meetupId === where.meetupId_requesterId.meetupId && item.requesterId === where.meetupId_requesterId.requesterId);
        return request ? { ...request, meetup: withCounts(meetups.find((meetup) => meetup.id === request.meetupId)) } : null;
      },
      create: async ({ data }: any) => {
        const request = { id: `request-${requests.length + 1}`, status: 'pending', createdAt: new Date(), updatedAt: new Date(), ...data };
        requests.push(request);
        return request;
      },
      update: async ({ where, data }: any) => {
        const request = requests.find((item) => item.id === where.id);
        Object.assign(request, data, { updatedAt: new Date() });
        return request;
      },
    },
    coffeeMeetupReport: {
      upsert: async ({ where, create, update }: any) => {
        const existing = reports.find((item) => item.meetupId === where.meetupId_reporterId.meetupId && item.reporterId === where.meetupId_reporterId.reporterId);
        if (existing) Object.assign(existing, update);
        else reports.push({ id: `report-${reports.length + 1}`, ...create });
        return existing ?? reports.at(-1);
      },
      updateMany: async ({ where, data }: any) => {
        reports.filter((item) => item.meetupId === where.meetupId && item.resolvedAt === where.resolvedAt).forEach((item) => Object.assign(item, data));
        return { count: reports.length };
      },
    },
    $queryRaw: async (_sql: TemplateStringsArray, ids: string[]) => ids.map((meetupId) => ({
      meetupId,
      accepted: requests.filter((request) => request.meetupId === meetupId && request.status === 'accepted').length,
      pending: requests.filter((request) => request.meetupId === meetupId && request.status === 'pending').length,
    })),
    $transaction: async (arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  };
  return { prisma, meetups, requests, reports };
}

test('CoffeeMeetupsService creates using auth user and public list computes accepted seats', async () => {
  const { prisma, requests } = createPrisma();
  const service = new CoffeeMeetupsService(prisma);
  const meetup = await service.create('organizer-1', {
    cafeId: 'cafe-1',
    purpose: 'Work',
    title: 'Morning coffee',
    startsAt: future(2).toISOString(),
    endsAt: future(3).toISOString(),
    maxParticipants: 3,
    contactInfo: 'Zalo: 0901234567',
    purposeIcon: 'games',
    purposeColor: '#1d4ed8',
  });
  requests.push({ id: 'accepted', meetupId: meetup.id, requesterId: 'user-1', status: 'accepted' });

  const listed = await service.list({});

  assert.equal(meetup.organizerId, 'organizer-1');
  assert.equal(meetup.contactInfo, 'Zalo: 0901234567');
  assert.equal(meetup.purposeIcon, 'games');
  assert.equal(meetup.purposeColor, '#1d4ed8');
  assert.equal((await service.detail(meetup.id)).purposeColor, '#1d4ed8');
  assert.equal((await service.detail(meetup.id)).purposeIcon, 'games');
  const custom = await service.update('organizer-1', meetup.id, { purpose: 'Chơi boardgame', purposeIcon: 'coffee', purposeColor: '#166638' });
  assert.equal(custom.purpose, 'Chơi boardgame');
  assert.equal(custom.purposeIcon, 'coffee');
  assert.equal(custom.purposeColor, '#166638');
  assert.equal((await service.detail(meetup.id)).contactInfo, 'Zalo: 0901234567');
  assert.equal((await service.update('organizer-1', meetup.id, { contactInfo: 'Facebook: cafe-test' })).contactInfo, 'Facebook: cafe-test');
  assert.equal((await service.update('organizer-1', meetup.id, { contactInfo: '' })).contactInfo, null);
  assert.equal(listed.data[0].acceptedCount, 2);
});

test('Coffee meetup contact details are optional, trimmed, and limited to 200 characters', () => {
  const payload = { cafeId: '392c43a1-c8ec-4470-9a1d-23b95f96f917', purpose: 'Work', title: 'Morning coffee', startsAt: future(2).toISOString(), endsAt: future(3).toISOString(), maxParticipants: 3 };
  assert.equal(validateSync(plainToInstance(CreateCoffeeMeetupDto, payload)).length, 0);
  const valid = plainToInstance(CreateCoffeeMeetupDto, { ...payload, contactInfo: '  Zalo: 0901234567  ' });
  assert.equal(valid.contactInfo, 'Zalo: 0901234567');
  assert.equal(validateSync(valid).length, 0);
  for (const contactInfo of ['x'.repeat(201), { phone: '0901234567' }]) {
    assert(validateSync(plainToInstance(CreateCoffeeMeetupDto, { ...payload, contactInfo })).some((error) => error.property === 'contactInfo'));
  }
});

test('Coffee meetup accepts custom purposes and only known icon IDs', () => {
  const payload = { cafeId: '392c43a1-c8ec-4470-9a1d-23b95f96f917', purpose: 'Chơi boardgame', purposeIcon: 'games', title: 'Boardgame cafe', startsAt: future(2).toISOString(), endsAt: future(3).toISOString(), maxParticipants: 3 };
  assert.equal(validateSync(plainToInstance(CreateCoffeeMeetupDto, payload)).length, 0);
  assert.equal(validateSync(plainToInstance(CreateCoffeeMeetupDto, { ...payload, purposeColor: '#1d4ed8' })).length, 0);
  for (const purposeColor of ['red', 'url(javascript:alert(1))', '#nothex']) {
    assert(validateSync(plainToInstance(CreateCoffeeMeetupDto, { ...payload, purposeColor })).some((error) => error.property === 'purposeColor'));
  }
  assert(validateSync(plainToInstance(CreateCoffeeMeetupDto, { ...payload, purposeIcon: '<svg>' })).some((error) => error.property === 'purposeIcon'));
  for (const purpose of [' ', 'x'.repeat(81)]) {
    assert(validateSync(plainToInstance(CreateCoffeeMeetupDto, { ...payload, purpose })).some((error) => error.property === 'purpose'));
  }
});

test('Coffee meetup place validation keeps stable purposes and rejects unsafe Maps URLs', () => {
  assert.equal(normalizePurpose('Học tập'), 'study');
  assert.equal(normalizePurpose('Study'), 'study');
  assert.equal(normalizePurpose('Boardgame'), 'Boardgame');
  assert.equal(normalizeGoogleMapsUrl('https://maps.google.com/?cid=123'), 'https://www.google.com/maps?cid=123');
  for (const url of [
    'https://maps.app.goo.gl/abc123',
    'https://goo.gl/maps/abc123',
    'https://www.google.com/maps/search/cafe',
  ]) assert.equal(normalizeGoogleMapsUrl(url), url);
  assert.equal(normalizeGoogleMapsUrl('https://maps.google.com/?cid=123'), 'https://www.google.com/maps?cid=123');
  for (const url of [
    'http://maps.app.goo.gl/abc123',
    'https://evil.example/maps/abc123',
    'https://google.com/places/cafe',
    'https://maps.app.goo.gl/',
  ]) assert.equal(normalizeGoogleMapsUrl(url), null);
});

test('CoffeeMeetupsService blocks self join, duplicate active request, and over-capacity accept', async () => {
  const { prisma, meetups, requests } = createPrisma();
  const service = new CoffeeMeetupsService(prisma);
  meetups.push({
    id: 'meetup-1',
    cafeId: 'cafe-1',
    organizerId: 'organizer-1',
    startsAt: future(2),
    endsAt: future(3),
    maxParticipants: 2,
    status: 'open',
    isHidden: false,
  });
  requests.push({ id: 'request-1', meetupId: 'meetup-1', requesterId: 'user-1', status: 'pending' });

  await assert.rejects(() => service.request('organizer-1', 'meetup-1', {}), BadRequestException);
  await assert.rejects(() => service.request('user-1', 'meetup-1', {}), BadRequestException);
  await assert.rejects(() => service.accept('user-1', 'request-1'), ForbiddenException);
  const accepted = await service.accept('organizer-1', 'request-1');

  assert.equal(requests[0].status, 'accepted');
  assert.equal(accepted.status, 'full');
  assert.equal(meetups[0].status, 'full');
});

test('CoffeeMeetupsService upserts reports and admin hide resolves reports', async () => {
  const { prisma, meetups, requests, reports } = createPrisma();
  const service = new CoffeeMeetupsService(prisma);
  meetups.push({
    id: 'meetup-1',
    cafeId: 'cafe-1',
    organizerId: 'organizer-1',
    startsAt: future(2),
    endsAt: future(3),
    maxParticipants: 4,
    status: 'open',
    isHidden: false,
  });

  meetups[0].adminNote = 'Private moderation note';
  requests.push(
    { id: 'accepted-1', meetupId: 'meetup-1', requesterId: 'user-1', status: 'accepted', message: 'Private message' },
    { id: 'pending-1', meetupId: 'meetup-1', requesterId: 'user-2', status: 'pending' },
  );
  await service.report('user-1', 'meetup-1', { reason: 'Spam' });
  await service.report('user-1', 'meetup-1', { reason: 'Khác', note: 'updated' });
  const guest = await service.detail('meetup-1');
  assert.equal(guest.organizerName, 'Cafe Maps user');
  assert.deepEqual(guest.acceptedParticipants, [{ displayName: 'Lan' }]);
  assert.deepEqual(guest.requests, []);
  const owner = await service.detail('meetup-1', 'organizer-1');
  assert.equal(owner.requests.length, 2);
  assert.equal(owner.requests[0].message, 'Private message');
  for (const response of [guest, owner, (await service.list({})).data[0]]) {
    for (const field of ['adminNote', 'reportCount', 'reports']) assert(!(field in response));
    assert(!JSON.stringify(response).includes('@example.com'));
  }
  const member = await service.detail('meetup-1', 'user-2');
  assert.deepEqual(member.requests.map((request) => request.id), ['pending-1']);
  const admin = await service.adminDetail('meetup-1');
  assert.equal(admin.organizer?.email, 'organizer-1@example.com');
  assert.equal(admin.requests[0].requester?.email, 'user-1@example.com');
  assert.equal(admin.adminNote, 'Private moderation note');
  assert.equal(admin.reports.length, 1);
  assert.equal((await service.adminList({})).data[0]['reportCount'], 1);

  const patched = await service.adminPatch('admin-1', 'meetup-1', { isHidden: true, resolveReports: true });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].reason, 'Khác');
  assert.equal(reports[0].resolvedById, 'admin-1');
  assert.equal(patched.isHidden, true);
});

test('Withdrawal preserves closed and expired meetups, and is idempotent', async () => {
  for (const [status, endsAt, requestStatus, nextStatus] of [
    ['cancelled', future(2), 'accepted', 'cancelled'],
    ['completed', future(2), 'pending', 'completed'],
    ['completed', future(2), 'accepted', 'completed'],
    ['full', future(-1), 'accepted', 'full'],
    ['full', future(2), 'accepted', 'open'],
  ] as const) {
    const { prisma, meetups, requests } = createPrisma();
    const service = new CoffeeMeetupsService(prisma);
    meetups.push({ id: 'meetup-1', organizerId: 'host', status, endsAt, isHidden: false, maxParticipants: 2 });
    requests.push({ id: 'request-1', meetupId: 'meetup-1', requesterId: 'guest', status: requestStatus });
    const result = await service.withdraw('guest', 'request-1');
    assert.equal(result.status, nextStatus);
    assert.equal(result.myRequestStatus, 'withdrawn');
    const withdrawnAt = requests[0].withdrawnAt;
    await service.withdraw('guest', 'request-1');
    assert.equal(requests[0].withdrawnAt, withdrawnAt);
  }
});
