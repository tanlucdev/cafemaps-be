import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';

const apiUrl = process.env.CAFE_DETAIL_TEST_API_URL;
const dbUrl = process.env.CAFE_DETAIL_TEST_DATABASE_URL;
const measureUrl = process.env.CAFE_DETAIL_TEST_MEASURE_URL;

test('monthly detail access through HTTP and PostgreSQL', { skip: !apiUrl || !dbUrl }, async () => {
  for (const url of [apiUrl!, dbUrl!, measureUrl ?? apiUrl!]) {
    assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname));
  }
  const prisma = new PrismaClient({ datasourceUrl: dbUrl });
  const prefix = `detail-${randomUUID()}`;
  const password = 'test-local-only';
  const cafes: { id: string; slug: string }[] = [];
  const accounts: string[] = [];
  const browsers: string[] = [];

  function browser(base = apiUrl) {
    const cookies = new Map<string, string>();
    return {
      get cookie() {
        return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
      },
      async request(path: string, method = 'GET', body?: object) {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: { Cookie: this.cookie, 'Content-Type': 'application/json' },
          body: body && JSON.stringify(body),
        });
        for (const header of response.headers.getSetCookie()) {
          const [, key, value] = /^([^=]+)=([^;]*)/.exec(header)!;
          if (value) cookies.set(key, value);
          else cookies.delete(key);
          if (key === 'cafe-detail-guest' && value) browsers.push(`guest:${value.split('.')[0]}`);
        }
        const payload = await response.json();
        return { response, payload };
      },
    };
  }

  type Browser = ReturnType<typeof browser>;
  const openPath = (index: number) => `/cafes/${cafes[index].slug}/detail-access`;

  async function checked(
    client: Browser,
    status: number,
    path: string,
    method = 'GET',
    body?: object,
  ) {
    const result = await client.request(path, method, body);
    assert.equal(
      result.response.status,
      status,
      `${method} ${path}: ${JSON.stringify(result.payload)}`,
    );
    return result;
  }

  async function quota(client: Browser) {
    const result = await checked(client, 200, '/cafes/detail-quota');
    assert.equal(result.response.headers.get('cache-control'), 'private, no-store');
    assert.equal(result.response.headers.get('set-cookie'), null);
    return result.payload;
  }

  async function open(client: Browser, index: number, status = 200) {
    const result = await checked(client, status, openPath(index), 'POST');
    assert.equal(result.response.headers.get('cache-control'), 'private, no-store');
    return result.payload;
  }

  async function register(client: Browser, name: string) {
    const email = `${prefix}-${name}@example.test`;
    const { payload } = await checked(client, 201, '/auth/register', 'POST', { email, password });
    accounts.push(payload.user.id);
    return { email, id: payload.user.id };
  }

  const free = (id: string) =>
    prisma.cafeDetailOpen.findMany({
      where: { identity: `user:${id}`, free: true },
    });

  try {
    for (let i = 0; i < 18; i++) {
      const cafe = await prisma.cafe.create({
        data: {
          slug: `${prefix}-${i}`,
          name: `${prefix} ${i}`,
          vibes: ['Cozy'],
          purposes: [],
          amenities: [],
          coverImage: 'https://example.test/cover.webp',
          description: 'Private detail',
          images: ['https://example.test/album.webp'],
          menuImages: ['https://example.test/menu.webp'],
        },
        select: { id: true, slug: true },
      });
      cafes.push(cafe);
    }

    const guest = browser();
    const accountBrowser = browser();
    const account = await register(accountBrowser, 'merge');
    assert.deepEqual(await quota(guest), { status: 'limited', remaining: 10, limit: 10 });

    for (const path of [
      `/cafes/${cafes[0].slug}`,
      `/cafes?search=${prefix}&page=2&limit=9`,
      `/cafes/${cafes[0].slug}/similar`,
      '/cafes/quiz-match?vibes=Cozy',
    ]) {
      const { response, payload } = await checked(guest, 200, path);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.doesNotMatch(JSON.stringify(payload), /Private detail|album\.webp|menu\.webp/);
      if (path.startsWith('/cafes?')) assert.equal(payload.data.length, 9);
    }
    assert.equal((await free(account.id)).length, 0);

    const missing = await fetch(`${apiUrl}${openPath(0)}`, { method: 'POST' });
    assert.equal(missing.status, 428);
    assert.equal((await missing.json()).message, 'DETAIL_COOKIE_REQUIRED');
    await open(guest, 8, 428);
    assert.equal(await prisma.cafeDetailOpen.count({ where: { identity: browsers.at(-1) } }), 0);
    for (let i = 8; i < 13; i++) await open(guest, i);
    assert.deepEqual(await quota(guest), { status: 'limited', remaining: 5, limit: 10 });
    await open(accountBrowser, 0, 428);
    for (let i = 0; i < 8; i++) await open(accountBrowser, i);

    const guestCookie = guest.cookie;
    await checked(guest, 201, '/auth/login', 'POST', { email: account.email, password });
    assert.ok(guest.cookie.startsWith(guestCookie));
    assert.deepEqual(await quota(guest), { status: 'limited', remaining: 0, limit: 10 });
    assert.deepEqual(
      new Set((await free(account.id)).map(({ cafeId }) => cafeId)),
      new Set(cafes.slice(0, 10).map(({ id }) => id)),
    );
    const detail = await open(guest, 9);
    assert.deepEqual(detail.images, ['https://example.test/album.webp']);
    assert.deepEqual(detail.menuImages, ['https://example.test/menu.webp']);
    assert.equal(detail.description, 'Private detail');
    for (let i = 10; i < 13; i++) {
      assert.equal((await open(guest, i, 403)).message, 'DETAIL_QUOTA_EXHAUSTED');
    }

    await prisma.cafeDetailEntitlement.create({
      data: { userId: account.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    assert.equal((await quota(guest)).status, 'unlimited');
    await open(guest, 10);
    await open(guest, 11);
    assert.equal((await free(account.id)).length, 10);
    await prisma.cafeDetailEntitlement.update({
      where: { userId: account.id },
      data: { expiresAt: new Date(0) },
    });
    await open(guest, 9);
    await open(guest, 10, 403);
    await checked(guest, 201, '/auth/logout', 'POST');
    assert.equal(guest.cookie, guestCookie);
    assert.deepEqual(await quota(guest), { status: 'login-required' });
    assert.equal((await open(guest, 13, 401)).message, 'DETAIL_LOGIN_REQUIRED');
    await open(guest, 8, 401);

    const tab = browser();
    const racer = await register(tab, 'race');
    await open(tab, 0, 428);
    for (let i = 0; i < 8; i++) await open(tab, i);
    let committed: Promise<Response> | undefined;
    const proxy = createServer((_req, res) => {
      committed = fetch(`${apiUrl}${openPath(8)}`, {
        method: 'POST',
        headers: { Cookie: tab.cookie },
      });
      res.on('close', () => res.destroy());
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    try {
      await assert.rejects(
        fetch(`http://127.0.0.1:${(proxy.address() as AddressInfo).port}`, {
          signal: AbortSignal.timeout(400),
        }),
        { name: 'TimeoutError' },
      );
      assert.equal((await committed)?.status, 200);
      await open(tab, 8);
      assert.equal((await free(racer.id)).length, 9);
    } finally {
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }

    const competing = await Promise.all([9, 10].map((i) => tab.request(openPath(i), 'POST')));
    assert.deepEqual(competing.map(({ response }) => response.status).sort(), [200, 403]);
    const current = await free(racer.id);
    assert.equal(current.length, 10);
    const month = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());
    assert.ok(current.every((row) => row.month === month));

    const old = '2020-01';
    await prisma.cafeDetailOpen.updateMany({
      where: { identity: `user:${racer.id}`, month },
      data: { month: old },
    });
    await prisma.cafeDetailBrowserMonth.updateMany({
      where: { browser: browsers.at(-1), month },
      data: { month: old },
    });
    await open(tab, 13);
    assert.equal((await free(racer.id)).filter((row) => row.month === month).length, 1);
    await checked(tab, 201, '/auth/logout', 'POST');
    await open(tab, 14, 401);

    const rollover = browser();
    await open(rollover, 14, 428);
    await prisma.cafeDetailBrowserMonth.create({ data: { browser: browsers.at(-1)!, month: old } });
    await open(rollover, 14);
    for (let i = 0; i < 9; i++) await open(rollover, i);
    await open(rollover, 14);
    await open(rollover, 15, 401);

    if (measureUrl) {
      const observer = browser(measureUrl);
      assert.deepEqual(await quota(observer), { status: 'measure' });
      const measured = await register(observer, 'measure');
      await open(observer, 0, 428);
      for (let i = 0; i < 12; i++) await open(observer, i);
      await open(observer, 11);
      assert.equal((await free(measured.id)).length, 10);
      assert.equal(
        await prisma.cafeDetailOpen.count({ where: { identity: `user:${measured.id}` } }),
        12,
      );
      await checked(observer, 201, '/auth/logout', 'POST');
      await open(observer, 15);
    }
  } finally {
    await prisma.cafeDetailOpen.deleteMany({
      where: { cafeId: { in: cafes.map(({ id }) => id) } },
    });
    await prisma.cafeDetailBrowserMonth.deleteMany({ where: { browser: { in: browsers } } });
    await prisma.user.deleteMany({ where: { id: { in: accounts } } });
    await prisma.cafe.deleteMany({ where: { id: { in: cafes.map(({ id }) => id) } } });
    await prisma.$disconnect();
  }
});
