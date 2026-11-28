import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PayOS, type WebhookData } from '@payos/node';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';

const database = process.env.PAYOS_TEST_DATABASE_URL;

test(
  'checkout, signed PayOS webhook, and exactly-once 30-day access',
  { skip: !database },
  async () => {
    assert.equal(new URL(database!).hostname, '127.0.0.1');
    const prisma = new PrismaClient({ datasourceUrl: database });
    const checksumKey = 'local-payment-checksum';
    const signer = new PayOS({ clientId: 'test', apiKey: 'test', checksumKey });
    const signature = (data: object) => signer.crypto.createSignatureFromObj(data, checksumKey);
    const ids: string[] = [];
    const links = new Map<number, string>();
    const amounts = new Map<number, number>();
    const expired = new Set<number>();
    const vendor = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url?.startsWith('/v2/payment-requests/')) {
        const orderCode = Number(req.url.split('/').at(-1));
        const data = {
          id: links.get(orderCode),
          orderCode,
          amount: amounts.get(orderCode),
          amountPaid: 0,
          status: expired.has(orderCode) ? 'EXPIRED' : 'PENDING',
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ code: '00', desc: 'success', data, signature: await signature(data) }),
        );
        return;
      }
      if (req.method !== 'POST' || req.url !== '/v2/payment-requests') {
        res.writeHead(501).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      amounts.set(body.orderCode, body.amount);
      assert.equal(
        await signer.crypto.createSignatureOfPaymentRequest(body, checksumKey),
        body.signature,
      );
      const paymentLinkId = randomUUID();
      links.set(body.orderCode, paymentLinkId);
      const data = {
        orderCode: body.orderCode,
        amount: body.amount,
        currency: 'VND',
        description: body.description,
        accountNumber: '0000000000',
        accountName: 'Test',
        bin: '000000',
        paymentLinkId,
        status: 'PENDING',
        checkoutUrl: 'https://pay.payos.vn/web/test-only',
        qrCode: 'test-only-payOS-qr',
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ code: '00', desc: 'success', data, signature: await signature(data) }),
      );
    });
    await new Promise<void>((resolve) => vendor.listen(0, '127.0.0.1', resolve));

    Object.assign(process.env, {
      DATABASE_URL: database,
      JWT_SECRET: 'local-payment-test-jwt',
      GOOGLE_CLIENT_ID: 'test',
      GOOGLE_CLIENT_SECRET: 'test',
      GOOGLE_OAUTH_REDIRECT_URI: 'http://127.0.0.1/auth/oauth/google/callback',
      RESEND_API_KEY: 're_local_only',
      CAFE_DETAIL_ACCESS_MODE: 'enforce',
      PAYOS_CLIENT_ID: 'test',
      PAYOS_API_KEY: 'test',
      PAYOS_CHECKSUM_KEY: checksumKey,
      PAYOS_RETURN_URL: 'http://127.0.0.1/vi',
      PAYOS_BASE_URL: `http://127.0.0.1:${(vendor.address() as AddressInfo).port}`,
    });

    const app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1');
    const root = await app.getUrl();
    async function call(path: string, status: number, options: RequestInit = {}) {
      const response = await fetch(root + path, options);
      const payload = await response.json();
      assert.equal(response.status, status, JSON.stringify(payload));
      return { payload, response };
    }

    async function register() {
      const { payload } = await call('/auth/register', 201, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `${randomUUID()}@example.test`,
          password: 'local-test-only',
        }),
      });
      ids.push(payload.user.id);
      return { Authorization: `Bearer ${payload.token}` };
    }

    const checkoutPath = '/payments/cafe-detail';
    async function deliver(data: WebhookData, valid: boolean, status = 200) {
      return call('/payments/payos/webhook', status, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: '00',
          desc: 'success',
          success: true,
          data,
          signature: valid ? await signature(data) : 'invalid',
        }),
      });
    }

    try {
      await call(checkoutPath, 401, { method: 'POST' });
      const pricingPath = checkoutPath + '/pricing';
      assert.deepEqual((await call(pricingPath, 200)).payload, {
        launchPrice: 10_000,
        standardPrice: 19_000,
        launchLimit: 5,
        launchRemaining: 5,
      });
      const buyer = await register();
      const stranger = await register();
      const requests = await Promise.all([
        call(checkoutPath, 201, { method: 'POST', headers: buyer }),
        call(checkoutPath, 201, { method: 'POST', headers: buyer }),
      ]);
      const [{ payload: order, response }] = requests;
      assert.equal(links.size, 1);
      assert.equal(order.amount, 10_000);
      assert.equal(amounts.get(order.orderCode), order.amount);
      assert.equal(requests[1].payload.orderCode, order.orderCode);
      assert.match(order.qrImage, /^data:image\/png;base64,/);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      const status = checkoutPath + '/' + order.orderCode;
      assert.equal((await call(status, 200, { headers: buyer })).payload.status, 'pending');
      await call(status, 404, { headers: stranger });

      const event = {
        orderCode: order.orderCode,
        amount: 10_000,
        currency: 'VND',
        description: 'Cafe Maps 30 ngay',
        paymentLinkId: links.get(order.orderCode)!,
        accountNumber: '0000000000',
        reference: 'LOCAL001',
        transactionDateTime: '2026-11-26 09:00:00',
        code: '00',
        desc: 'success',
      };
      await deliver(event, false, 400);
      await deliver({ ...event, amount: 9000 }, true);
      await deliver({ ...event, paymentLinkId: randomUUID() }, true);
      assert.equal(await prisma.cafeDetailEntitlement.count({ where: { userId: ids[0] } }), 0);

      await Promise.all([deliver(event, true), deliver(event, true)]);
      assert.equal((await call(status, 200, { headers: buyer })).payload.status, 'paid');
      const entitlement = await prisma.cafeDetailEntitlement.findUniqueOrThrow({
        where: { userId: ids[0] },
      });
      const difference = Math.abs(entitlement.expiresAt.getTime() - Date.now() - 30 * 86_400_000);
      assert.ok(difference < 5000);
      await deliver(event, true);
      assert.equal(
        (
          await prisma.cafeDetailEntitlement.findUniqueOrThrow({ where: { userId: ids[0] } })
        ).expiresAt.getTime(),
        entitlement.expiresAt.getTime(),
      );
      assert.equal(
        (await call(checkoutPath, 201, { method: 'POST', headers: buyer })).payload.status,
        'paid',
      );
      const mockPathFor = (code: number) => `${checkoutPath}/${code}/mock-complete`;
      await call(mockPathFor(order.orderCode), 404, { method: 'POST', headers: buyer });
      Object.assign(process.env, { NODE_ENV: 'development', PAYOS_MOCK_ENABLED: 'true' });
      const { payload: mockOrder } = await call(checkoutPath, 201, {
        method: 'POST',
        headers: stranger,
      });
      assert.equal(mockOrder.mock, true);
      assert.equal(mockOrder.checkoutUrl, null);
      assert.match(mockOrder.qrImage, /^data:image\/png;base64,/);
      assert.equal(links.size, 1);
      const mockPath = mockPathFor(mockOrder.orderCode);
      await call(mockPath, 404, { method: 'POST', headers: buyer });
      await Promise.all(
        Array.from({ length: 2 }, () => call(mockPath, 200, { method: 'POST', headers: stranger })),
      );
      const grant = await prisma.cafeDetailEntitlement.findUniqueOrThrow({
        where: { userId: ids[1] },
      });
      assert.ok(Math.abs(grant.expiresAt.getTime() - Date.now() - 30 * 86_400_000) < 5000);
      assert.equal(
        (await call(checkoutPath + '/' + mockOrder.orderCode, 200, { headers: stranger })).payload
          .status,
        'paid',
      );
      process.env.NODE_ENV = 'production';
      await call(mockPath, 404, { method: 'POST', headers: stranger });

      assert.equal((await call(pricingPath, 200)).payload.launchRemaining, 4);
      const participants = await Promise.all(Array.from({ length: 5 }, () => register()));
      const batch = await Promise.all(
        participants.map(async (headers) => {
          const response = await fetch(root + checkoutPath, { method: 'POST', headers });
          return { status: response.status, payload: await response.json(), headers };
        }),
      );
      const held = batch.filter((entry) => entry.status === 201);
      assert.equal(held.length, 4);
      assert.ok(held.every(({ payload }) => payload.amount === 10_000));
      const waiting = batch.find((entry) => entry.status === 409)!;
      assert.equal(waiting.payload.message, 'CAFE_LAUNCH_OFFER_RESERVED');
      const abandoned = held.pop()!.payload;
      await prisma.cafeDetailPayment.update({
        where: { orderCode: BigInt(abandoned.orderCode) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await call(checkoutPath, 409, { method: 'POST', headers: waiting.headers });
      expired.add(abandoned.orderCode);
      const { payload: replacement } = await call(checkoutPath, 201, {
        method: 'POST',
        headers: waiting.headers,
      });
      assert.equal(replacement.amount, 10_000);
      for (const { orderCode } of [...held.map(({ payload }) => payload), replacement]) {
        await deliver({ ...event, orderCode, paymentLinkId: links.get(orderCode)! }, true);
      }
      assert.equal((await call(pricingPath, 200)).payload.launchRemaining, 0);
      const regularBuyer = await register();
      const { payload: standard } = await call(checkoutPath, 201, {
        method: 'POST',
        headers: regularBuyer,
      });
      assert.equal(standard.amount, 19_000);
      assert.equal(amounts.get(standard.orderCode), 19_000);
      const standardEvent = {
        ...event,
        orderCode: standard.orderCode,
        paymentLinkId: links.get(standard.orderCode)!,
      };
      await deliver(standardEvent, true);
      const standardPath = checkoutPath + '/' + standard.orderCode;
      assert.equal(
        (await call(standardPath, 200, { headers: regularBuyer })).payload.status,
        'pending',
      );
      await deliver({ ...standardEvent, amount: 19_000 }, true);
      assert.equal(
        (await call(standardPath, 200, { headers: regularBuyer })).payload.status,
        'paid',
      );
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
      await app.close();
      await new Promise<void>((resolve) => vendor.close(() => resolve()));
    }
  },
);
