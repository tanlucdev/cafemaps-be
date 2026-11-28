import { randomInt } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayOS, type Webhook, type WebhookData } from '@payos/node';
import { Prisma } from '@prisma/client';
import { toDataURL } from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { getCheckoutAmount, getLaunchPricing, MOCK_PREFIX } from './launch-offer';

const CHECKOUT_MINUTES = 15;

function paymentOrderCode(orderCode: number) {
  if (!Number.isSafeInteger(orderCode) || orderCode < 1) throw new BadRequestException();
  return BigInt(orderCode);
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private mockEnabled() {
    if (
      this.config.get('NODE_ENV') !== 'development' ||
      this.config.get('PAYOS_MOCK_ENABLED') !== 'true'
    ) {
      return false;
    }
    const database = this.config.get<string>('DATABASE_URL');
    return Boolean(
      database && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(database).hostname),
    );
  }

  private provider() {
    const clientId = this.config.get<string>('PAYOS_CLIENT_ID');
    const apiKey = this.config.get<string>('PAYOS_API_KEY');
    const checksumKey = this.config.get<string>('PAYOS_CHECKSUM_KEY');
    if (!clientId || !apiKey || !checksumKey) {
      throw new ServiceUnavailableException('PAYOS_NOT_CONFIGURED');
    }
    return new PayOS({ clientId, apiKey, checksumKey, timeout: 4000, maxRetries: 0 });
  }

  pricing() {
    return getLaunchPricing(this.prisma, this.mockEnabled());
  }

  async checkout(userId: string) {
    const mock = this.mockEnabled();
    const payment = await this.prisma.$transaction(
      async (tx) => {
        const lock = `user:${userId}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0)) IS NULL`;
        const now = new Date();
        const entitlement = await tx.cafeDetailEntitlement.findUnique({ where: { userId } });
        if (entitlement && entitlement.expiresAt > now) return null;
        const pending = await tx.cafeDetailPayment.findFirst({
          where: {
            userId,
            paidAt: null,
            offerReleasedAt: null,
            expiresAt: { gt: now },
            paymentLinkId: mock
              ? { startsWith: MOCK_PREFIX }
              : { not: { startsWith: MOCK_PREFIX } },
          },
          orderBy: { expiresAt: 'desc' },
        });
        if (pending) return pending;

        const amount = await getCheckoutAmount(tx, userId, mock, (orderCode) =>
          this.provider().paymentRequests.get(orderCode),
        );
        if (amount === null) return 'offer-reserved' as const;
        const expiresAt = new Date(Date.now() + CHECKOUT_MINUTES * 60_000);
        const orderCode = randomInt(100_000_000_000_000, 350_000_000_000_000);
        const order = await tx.cafeDetailPayment.create({
          data: { orderCode: BigInt(orderCode), userId, expiresAt, amount },
        });
        if (mock) {
          return tx.cafeDetailPayment.update({
            where: { orderCode: order.orderCode },
            data: {
              paymentLinkId: `${MOCK_PREFIX}${orderCode}`,
              qrCode: `Cafe Maps demo order ${orderCode}. No bank transfer.`,
            },
          });
        }

        const payos = this.provider();
        const returnUrl = this.config.get<string>('PAYOS_RETURN_URL');
        if (!returnUrl) throw new ServiceUnavailableException('PAYOS_RETURN_URL_NOT_CONFIGURED');

        try {
          const link = await payos.paymentRequests.create({
            orderCode,
            amount,
            description: 'Cafe Maps 30 ngay',
            returnUrl,
            cancelUrl: returnUrl,
            expiredAt: Math.floor(expiresAt.getTime() / 1000),
          });
          if (
            link.orderCode !== orderCode ||
            link.amount !== amount ||
            !link.paymentLinkId ||
            !link.qrCode ||
            new URL(link.checkoutUrl).protocol !== 'https:'
          )
            throw new Error('Invalid checkout response');
          return await tx.cafeDetailPayment.update({
            where: { orderCode: order.orderCode },
            data: {
              paymentLinkId: link.paymentLinkId,
              checkoutUrl: link.checkoutUrl,
              qrCode: link.qrCode,
            },
          });
        } catch {
          throw new BadGatewayException('PAYOS_CHECKOUT_FAILED');
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 12_000,
      },
    );
    if (!payment) return { status: 'paid' } as const;
    if (payment === 'offer-reserved') throw new ConflictException('CAFE_LAUNCH_OFFER_RESERVED');

    return {
      status: 'pending' as const,
      orderCode: Number(payment.orderCode),
      amount: payment.amount,
      expiresAt: payment.expiresAt,
      checkoutUrl: payment.checkoutUrl,
      mock,
      qrImage: await toDataURL(payment.qrCode!, { width: 256 }),
    };
  }

  async status(userId: string, orderCode: number) {
    const order = await this.prisma.cafeDetailPayment.findFirst({
      where: { orderCode: paymentOrderCode(orderCode), userId },
      select: { expiresAt: true, paidAt: true },
    });
    if (!order) throw new NotFoundException();
    return {
      status: order.paidAt ? 'paid' : order.expiresAt <= new Date() ? 'expired' : 'pending',
    };
  }

  async webhook(event: Webhook) {
    const payos = this.provider();
    let data: WebhookData;
    try {
      data = await payos.webhooks.verify(event);
    } catch {
      throw new BadRequestException('INVALID_PAYOS_WEBHOOK');
    }
    if (
      event.success === true &&
      event.code === '00' &&
      data.code === '00' &&
      data.currency === 'VND' &&
      Number.isSafeInteger(data.orderCode) &&
      data.orderCode > 0 &&
      data.paymentLinkId &&
      !data.paymentLinkId.startsWith(MOCK_PREFIX)
    ) {
      await this.settle(paymentOrderCode(data.orderCode), data.paymentLinkId, {
        amount: data.amount,
      });
    }
    return { ok: true };
  }

  async completeMock(userId: string, orderCode: number) {
    if (!this.mockEnabled()) throw new NotFoundException();
    const owned = await this.settle(paymentOrderCode(orderCode), `${MOCK_PREFIX}${orderCode}`, {
      mockUserId: userId,
    });
    if (!owned) throw new NotFoundException();
    return this.status(userId, orderCode);
  }

  private settle(
    orderCode: bigint,
    paymentLinkId: string,
    verification: { amount: number } | { mockUserId: string },
  ) {
    const mockUserId = 'mockUserId' in verification ? verification.mockUserId : undefined;
    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.cafeDetailPayment.findUnique({ where: { orderCode } });
        if (
          !order ||
          order.paymentLinkId !== paymentLinkId ||
          ('amount' in verification && order.amount !== verification.amount) ||
          (mockUserId && order.userId !== mockUserId)
        ) {
          return false;
        }

        const lock = `user:${order.userId}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0)) IS NULL`;
        const now = new Date();
        const { count } = await tx.cafeDetailPayment.updateMany({
          where: {
            orderCode,
            paidAt: null,
            offerReleasedAt: null,
            ...(mockUserId && { expiresAt: { gt: now } }),
          },
          data: { paidAt: now },
        });
        if (count) {
          await tx.$executeRaw`
          INSERT INTO cafe_detail_entitlements (user_id, expires_at)
          VALUES (${order.userId}::uuid, clock_timestamp() + interval '720 hours')
          ON CONFLICT (user_id) DO UPDATE
          SET expires_at = greatest(cafe_detail_entitlements.expires_at, clock_timestamp())
            + interval '720 hours'
        `;
        }
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
