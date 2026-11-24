import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient, Role } from '@prisma/client';

const apiUrl = process.env.MEETUP_TEST_API_URL;
const databaseUrl = process.env.MEETUP_TEST_DATABASE_URL;
const secret = process.env.MEETUP_TEST_JWT_SECRET;

test('meetup HTTP contract and concurrent approval on PostgreSQL', { skip: !apiUrl || !databaseUrl || !secret }, async () => {
  const local = ['localhost', '127.0.0.1', '[::1]'];
  assert(local.includes(new URL(apiUrl!).hostname));
  assert(local.includes(new URL(databaseUrl!).hostname));
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const jwt = new JwtService({ secret });
  const run = randomUUID();
  const accounts: string[] = [];

  async function account(displayName: string | null, role: Role = 'USER') {
    const user = await prisma.user.create({ data: { email: `${run}-${accounts.length}@example.test`, displayName, role } });
    accounts.push(user.id);
    return { id: user.id, token: jwt.sign({ sub: user.id, role }) };
  }

  async function request(method: string, path: string, token?: string, body?: object) {
    return fetch(`${apiUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
    });
  }

  async function checked(status: number, method: string, path: string, token?: string, body?: object) {
    const response = await request(method, path, token, body);
    const payload = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload;
  }

  const root = '/coffee-meetups';
  try {
    const host = await account(null);
    const lan = await account('Lan');
    const mai = await account('Mai');
    const admin = await account('Moderator', 'ADMIN');
    const create = () => checked(201, 'POST', root, host.token, {
      place: { kind: 'external', name: 'Test Coffee', googleMapsUrl: 'https://maps.google.com/?cid=123' },
      purpose: 'work', title: `Coffee ${run}`, contactInfo: 'Public contact',
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 7_200_000).toISOString(),
      maxParticipants: 2,
    });
    const meetup = await create();
    const path = `${root}/${meetup.id}`;
    assert.equal(meetup.place.googleMapsUrl, 'https://www.google.com/maps?cid=123');
    assert.equal(meetup.organizerName, 'Cafe Maps user');
    assert.equal(meetup.contactInfo, 'Public contact');

    await checked(400, 'GET', `${root}/invalid`);
    await checked(400, 'GET', `${root}?cafeId=invalid`);
    await checked(400, 'POST', `${root}/invalid/cancel`, host.token);
    await checked(400, 'DELETE', `${root}/requests/invalid`, lan.token);
    await checked(400, 'POST', `${root}/requests/invalid/accept`, host.token);
    await checked(400, 'PATCH', `/admin${root}/invalid`, admin.token);
    await checked(404, 'GET', `${root}/${randomUUID()}`);
    await checked(404, 'POST', `${root}/${randomUUID()}/report`, lan.token, { reason: 'Spam' });
    await checked(404, 'DELETE', `${root}/requests/${randomUUID()}`, lan.token);

    const join = async (meetupPath: string, token: string) =>
      (await checked(201, 'POST', `${meetupPath}/requests`, token, { message: 'Private request' })).requests[0].id;
    const pending = await Promise.all([join(path, lan.token), join(path, mai.token)]);
    await checked(403, 'POST', `${root}/requests/${pending[0]}/accept`, lan.token);
    const approvals = await Promise.all(pending.map((id) => request('POST', `${root}/requests/${id}/accept`, host.token)));
    assert.deepEqual(approvals.map(({ status }) => status).sort(), [201, 409]);
    const winner = approvals[0].ok ? lan : mai;
    const winnerIndex = approvals[0].ok ? 0 : 1;
    const winnerName = winnerIndex === 0 ? 'Lan' : 'Mai';
    const winnerRoute = `${root}/requests/${pending[winnerIndex]}`;
    const loserRoute = `${root}/requests/${pending[1 - winnerIndex]}`;

    await checked(201, 'POST', `${path}/report`, lan.token, { reason: 'Spam', note: 'Private report' });
    await checked(200, 'PATCH', `/admin${path}`, admin.token, { adminNote: 'Private moderation' });
    const publicDetail = await checked(200, 'GET', path);
    assert.equal(publicDetail.acceptedCount, 2);
    assert.deepEqual(publicDetail.acceptedParticipants, [{ displayName: winnerName }]);
    assert.deepEqual(publicDetail.requests, []);
    const ownerDetail = await checked(200, 'GET', path, host.token);
    assert.equal(ownerDetail.requests.length, 2);
    const memberDetail = await checked(200, 'GET', path, winner.token);
    assert.deepEqual(memberDetail.requests.map((item: { requesterId: string }) => item.requesterId), [winner.id]);
    const list = await checked(200, 'GET', `${root}?search=${run}`);
    for (const view of [publicDetail, ownerDetail, memberDetail, list.data[0]]) {
      for (const field of ['adminNote', 'reportCount', 'reports']) assert(!(field in view));
      assert(!JSON.stringify(view).includes('@example.test'));
    }
    const moderation = await checked(200, 'GET', `/admin${path}`, admin.token);
    assert.equal(moderation.adminNote, 'Private moderation');
    assert.equal(moderation.reportCount, 1);
    assert.equal(moderation.reports[0].note, 'Private report');
    assert.match(moderation.reports[0].reporter.email, /@example\.test$/);
    assert.match(moderation.organizer.email, /@example\.test$/);

    await checked(201, 'POST', `${path}/cancel`, host.token);
    await checked(409, 'POST', `${loserRoute}/accept`, host.token);
    const withdrawn = await checked(200, 'DELETE', winnerRoute, winner.token);
    assert.equal(withdrawn.status, 'cancelled');
    assert.equal(withdrawn.acceptedCount, 1);
    assert.deepEqual(withdrawn.acceptedParticipants, []);
    assert.equal((await checked(200, 'DELETE', winnerRoute, winner.token)).requests[0].withdrawnAt, withdrawn.requests[0].withdrawnAt);

    const completePath = `${root}/${(await create()).id}`;
    const completeRequest = `${root}/requests/${await join(completePath, lan.token)}`;
    await checked(201, 'POST', `${completeRequest}/accept`, host.token);
    await checked(201, 'POST', `${completePath}/complete`, host.token);
    assert.equal((await checked(200, 'DELETE', completeRequest, lan.token)).status, 'completed');

    await checked(200, 'PATCH', `/admin${path}`, admin.token, { isHidden: true });
    await checked(404, 'GET', path);
    await checked(404, 'POST', `${path}/report`, lan.token, { reason: 'Spam' });
    await checked(404, 'DELETE', winnerRoute, winner.token);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: accounts } } });
    await prisma.$disconnect();
  }
});
