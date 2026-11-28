import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { parseCookies } from '../auth/services/auth-cookie.service';
import { PrismaService } from '../prisma/prisma.service';

const COOKIE = 'cafe-detail-guest';
const FREE_LIMIT = 10;
const vietnamMonth = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
});

@Injectable()
export class CafeDetailAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private signature(id: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET'))
      .update(`${COOKIE}:${id}`)
      .digest('base64url');
  }

  readBrowser(cookieHeader?: string) {
    const token = parseCookies(cookieHeader)[COOKIE] ?? '';
    const match = /^([a-f0-9-]{36})\.([\w-]{43})$/.exec(token);
    if (!match) return null;
    const [, id, signature] = match;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(this.signature(id)))
      ? `guest:${id}`
      : null;
  }

  requireBrowser(cookieHeader: string | undefined, res: Response) {
    const browser = this.readBrowser(cookieHeader);
    if (browser) return browser;

    const id = randomUUID();
    res.cookie(COOKIE, `${id}.${this.signature(id)}`, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
    throw new HttpException('DETAIL_COOKIE_REQUIRED', 428);
  }

  async quota(browser: string | null, userId?: string) {
    if (this.config.get('CAFE_DETAIL_ACCESS_MODE') !== 'enforce') {
      return { status: 'measure' } as const;
    }

    const now = new Date();
    const month = vietnamMonth.format(now);
    if (userId) {
      const entitlement = await this.prisma.cafeDetailEntitlement.findUnique({
        where: { userId },
        select: { expiresAt: true },
      });
      if (entitlement && entitlement.expiresAt > now) {
        return { status: 'unlimited', expiresAt: entitlement.expiresAt } as const;
      }
    } else if (
      browser &&
      (await this.prisma.cafeDetailBrowserMonth.findUnique({
        where: { browser_month: { browser, month } },
        select: { browser: true },
      }))
    ) {
      return { status: 'login-required' } as const;
    }

    const identity = userId ? `user:${userId}` : browser;
    const used = identity
      ? await this.prisma.cafeDetailOpen.count({ where: { identity, month, free: true } })
      : 0;
    return {
      status: 'limited',
      remaining: Math.max(0, FREE_LIMIT - used),
      limit: FREE_LIMIT,
    } as const;
  }

  async mergeOnLogin(browser: string | null, userId: string) {
    if (!browser) return;
    const account = `user:${userId}`;
    await this.prisma.$transaction(
      async (tx) => {
        const { month } = await this.lock(tx, browser, account);
        await this.merge(tx, browser, account, month);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async open<T>(
    browser: string,
    userId: string | undefined,
    cafeId: string,
    loadDetail: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    const account = userId ? `user:${userId}` : undefined;
    const identity = account ?? browser;
    const enforce = this.config.get('CAFE_DETAIL_ACCESS_MODE') === 'enforce';

    return this.prisma.$transaction(
      async (tx) => {
        const { month, now } = await this.lock(tx, browser, account);
        const browserMonth = { browser, month };
        const usedAccount = await tx.cafeDetailBrowserMonth.findUnique({
          where: { browser_month: browserMonth },
        });

        if (!account && usedAccount && enforce) return { status: 'login-required' } as const;
        if (account && !usedAccount) await this.merge(tx, browser, account, month);

        const entitlement = userId
          ? await tx.cafeDetailEntitlement.findUnique({
              where: { userId },
              select: { expiresAt: true },
            })
          : null;
        const paid = Boolean(entitlement?.expiresAt && entitlement.expiresAt > now);
        const key = { identity, month, cafeId };
        const existing = await tx.cafeDetailOpen.findUnique({
          where: { identity_month_cafeId: key },
        });

        if (!paid && !existing?.free) {
          const used = await tx.cafeDetailOpen.count({ where: { identity, month, free: true } });
          const free = (account || !usedAccount) && used < FREE_LIMIT;
          if (!free && enforce) {
            return { status: account ? 'quota-exhausted' : 'guest-quota-exhausted' } as const;
          }
          if (!existing || free) {
            await tx.cafeDetailOpen.upsert({
              where: { identity_month_cafeId: key },
              create: { ...key, openedAt: now, free },
              update: { free, openedAt: now },
            });
          }
        }

        if (account && !usedAccount) {
          await tx.cafeDetailBrowserMonth.create({ data: browserMonth });
        }

        return { status: 'granted', cafe: await loadDetail(tx) } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async lock(tx: Prisma.TransactionClient, browser: string, account?: string) {
    const identities = account ? [browser, account].sort() : [browser];
    for (const identity of identities) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0)) IS NULL`;
    }
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    return { now, month: vietnamMonth.format(now) };
  }

  private async merge(
    tx: Prisma.TransactionClient,
    browser: string,
    account: string,
    month: string,
  ) {
    const kept = await tx.cafeDetailOpen.findMany({
      where: { identity: account, month, free: true },
      select: { cafeId: true },
    });
    if (kept.length >= FREE_LIMIT) return;
    const oldest = await tx.cafeDetailOpen.findMany({
      where: {
        identity: browser,
        month,
        free: true,
        cafeId: { notIn: kept.map(({ cafeId }) => cafeId) },
      },
      orderBy: [{ openedAt: 'asc' }, { cafeId: 'asc' }],
      take: FREE_LIMIT - kept.length,
      select: { cafeId: true, openedAt: true },
    });
    for (const { cafeId, openedAt } of oldest) {
      const key = { identity: account, month, cafeId };
      await tx.cafeDetailOpen.upsert({
        where: { identity_month_cafeId: key },
        create: { ...key, openedAt, free: true },
        update: { openedAt, free: true },
      });
    }
  }
}
