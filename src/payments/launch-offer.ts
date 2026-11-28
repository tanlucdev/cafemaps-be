import type { PaymentLink } from '@payos/node';
import type { Prisma } from '@prisma/client';

const LAUNCH_PRICE = 10_000;
const STANDARD_PRICE = 19_000;
const LAUNCH_LIMIT = 5;
export const MOCK_PREFIX = 'mock:';

function offerFilter(mock: boolean) {
  return {
    amount: LAUNCH_PRICE,
    paymentLinkId: mock ? { startsWith: MOCK_PREFIX } : { not: { startsWith: MOCK_PREFIX } },
    offerReleasedAt: null,
  };
}

function paidBuyers(db: Prisma.TransactionClient, mock: boolean) {
  return db.cafeDetailPayment.findMany({
    where: { ...offerFilter(mock), paidAt: { not: null } },
    distinct: ['userId'],
    select: { userId: true },
    take: LAUNCH_LIMIT,
  });
}

export async function getLaunchPricing(db: Prisma.TransactionClient, mock: boolean) {
  const buyers = await paidBuyers(db, mock);
  return {
    launchPrice: LAUNCH_PRICE,
    standardPrice: STANDARD_PRICE,
    launchLimit: LAUNCH_LIMIT,
    launchRemaining: LAUNCH_LIMIT - buyers.length,
  };
}

export async function getCheckoutAmount(
  tx: Prisma.TransactionClient,
  userId: string,
  mock: boolean,
  getPaymentLink: (orderCode: number) => Promise<PaymentLink>,
) {
  if ((await paidBuyers(tx, mock)).length >= LAUNCH_LIMIT) return STANDARD_PRICE;

  const lock = mock ? 'cafe-detail-launch:mock' : 'cafe-detail-launch';
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0)) IS NULL`;
  const buyers = await paidBuyers(tx, mock);
  if (buyers.length >= LAUNCH_LIMIT || buyers.some((buyer) => buyer.userId === userId)) {
    return STANDARD_PRICE;
  }

  const now = new Date();
  const offer = offerFilter(mock);
  const expired = await tx.cafeDetailPayment.findMany({
    where: { ...offer, paidAt: null, expiresAt: { lte: now } },
    select: { orderCode: true, userId: true, paymentLinkId: true },
  });
  // A late webhook can settle a payment made before expiration.
  const released = await Promise.all(
    expired.map(async (order) => {
      if (mock) return order.orderCode;
      const link = await getPaymentLink(Number(order.orderCode)).catch(() => null);
      if (
        link?.id === order.paymentLinkId &&
        link.orderCode === Number(order.orderCode) &&
        link.amount === LAUNCH_PRICE &&
        link.amountPaid === 0 &&
        (link.status === 'EXPIRED' || link.status === 'CANCELLED')
      )
        return order.orderCode;
      return null;
    }),
  );
  const orderCodes = released.filter((code) => code !== null);
  if (orderCodes.length) {
    await tx.cafeDetailPayment.updateMany({
      where: { orderCode: { in: orderCodes }, paidAt: null },
      data: { offerReleasedAt: now },
    });
  }
  if (expired.some((order) => order.userId === userId && !orderCodes.includes(order.orderCode)))
    return null;
  const reserved = await tx.cafeDetailPayment.count({ where: offer });
  if (reserved < LAUNCH_LIMIT) return LAUNCH_PRICE;
  if ((await paidBuyers(tx, mock)).length >= LAUNCH_LIMIT) return STANDARD_PRICE;
  return null;
}
