import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { adminCounts, adminUserSelect, cafeSelect, counts, dateWhere, normalizeGoogleMapsUrl, normalizePurpose, pageValue, purposeValues, searchWhere, seats, serializeAdminMeetup, serializeMeetup, statusData, userSelect } from './coffee-meetups.helpers';
import { AdminCoffeeMeetupListDto, CoffeeMeetupListDto, CoffeeMeetupRequestDto, CreateCoffeeMeetupDto, ReportCoffeeMeetupDto, UpdateCoffeeMeetupDto } from './dto/coffee-meetup.dto';

@Injectable()
export class CoffeeMeetupsService {
  constructor(private prisma: PrismaService) {}

  async list(dto: CoffeeMeetupListDto) {
    const page = pageValue(dto.page, 1);
    const limit = pageValue(dto.limit, 12, 50);
    if (dto.nearMe && (!Number.isFinite(dto.lat) || !Number.isFinite(dto.lng))) {
      throw new BadRequestException('Valid latitude and longitude are required for nearMe');
    }
    const where: any = {
      isHidden: false,
      status: dto.available ? 'open' : { in: ['open', 'full'] },
      endsAt: { gt: new Date() },
      ...(dto.cafeId ? { cafeId: dto.cafeId } : {}),
      ...(dto.purpose ? { purpose: { in: purposeValues(dto.purpose), mode: 'insensitive' } } : {}),
      ...(dto.area ? { cafe: { district: { contains: dto.area, mode: 'insensitive' } } } : {}),
      ...dateWhere(dto.date),
      ...searchWhere(dto.search),
    };
    if (!dto.nearMe) return this.page(where, page, limit);

    const candidates = await this.prisma.coffeeMeetup.findMany({ where: { ...where, cafeId: { not: null } }, select: { id: true } });
    if (!candidates.length) return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    const radiusMeters = (dto.radiusKm ?? 2) * 1000;
    const nearby = await this.prisma.$queryRaw<Array<{ id: string; distanceKm: number }>>`
      SELECT m.id, ROUND((ST_Distance(c.location, ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)::geography) / 1000)::numeric, 2)::float AS "distanceKm"
      FROM coffee_meetups m JOIN cafes c ON c.id = m.cafe_id
      WHERE m.id IN (${Prisma.join(candidates.map((candidate) => candidate.id))})
        AND c.location IS NOT NULL
        AND ST_DWithin(c.location, ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)::geography, ${radiusMeters})
      ORDER BY "distanceKm" ASC, m.starts_at ASC, m.id ASC
    `;
    const total = nearby.length;
    const ids = nearby.slice((page - 1) * limit, page * limit).map((row) => row.id);
    const distanceById = new Map(nearby.map((row) => [row.id, row.distanceKm]));
    return this.page({ id: { in: ids } }, page, limit, distanceById, ids, total);
  }

  async detail(id: string, viewerId?: string | null) {
    const meetup = await this.prisma.coffeeMeetup.findFirst({ where: { id, isHidden: false }, include: this.detailInclude() });
    if (!meetup) throw new NotFoundException('Coffee meetup not found');
    return serializeMeetup(meetup, true, viewerId);
  }

  async me(userId: string) {
    const data = await this.prisma.coffeeMeetup.findMany({
      where: { OR: [{ organizerId: userId }, { requests: { some: { requesterId: userId } } }] },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      include: {
        cafe: { select: cafeSelect }, organizer: { select: userSelect },
        requests: { where: { OR: [{ requesterId: userId }, { meetup: { organizerId: userId } }] }, include: { requester: { select: userSelect } }, orderBy: { createdAt: 'desc' } },
        _count: { select: counts },
      },
    });
    return { data: data.map((meetup) => serializeMeetup(meetup, true, userId, false, false)) };
  }

  async create(userId: string, dto: CreateCoffeeMeetupDto) {
    const place = await this.resolvePlace(dto);
    this.assertTimes(new Date(dto.startsAt), new Date(dto.endsAt));
    const meetup = await this.prisma.coffeeMeetup.create({ data: { ...place, organizerId: userId, purpose: normalizePurpose(dto.purpose), purposeIcon: dto.purposeIcon || null, purposeColor: dto.purposeColor || null, invitationTemplate: dto.invitationTemplate, invitationColor: dto.invitationColor, title: dto.title, description: dto.description || null, contactInfo: dto.contactInfo || null, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt), maxParticipants: dto.maxParticipants }, include: { cafe: { select: cafeSelect }, organizer: { select: userSelect }, _count: { select: counts } } });
    return serializeMeetup(meetup);
  }

  async update(userId: string, id: string, dto: UpdateCoffeeMeetupDto) {
    const current = await this.ownerMeetup(userId, id);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : current.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : current.endsAt;
    const maxParticipants = dto.maxParticipants ?? current.maxParticipants;
    this.assertTimes(startsAt, endsAt);
    if (maxParticipants < seats(current)) throw new BadRequestException('Capacity below accepted participants');
    const place = dto.place || dto.cafeId !== undefined ? await this.resolvePlace(dto) : {};
    const meetup = await this.prisma.coffeeMeetup.update({ where: { id }, data: { ...place, ...(dto.purpose ? { purpose: normalizePurpose(dto.purpose) } : {}), ...(dto.purposeIcon !== undefined ? { purposeIcon: dto.purposeIcon || null } : {}), ...(dto.purposeColor !== undefined ? { purposeColor: dto.purposeColor || null } : {}), invitationTemplate: dto.invitationTemplate, invitationColor: dto.invitationColor, ...(dto.title ? { title: dto.title } : {}), ...(dto.description !== undefined ? { description: dto.description || null } : {}), ...(dto.contactInfo !== undefined ? { contactInfo: dto.contactInfo || null } : {}), startsAt, endsAt, maxParticipants, status: seats(current) >= maxParticipants ? 'full' : 'open' }, include: { cafe: { select: cafeSelect }, organizer: { select: userSelect }, _count: { select: counts } } });
    return serializeMeetup(meetup);
  }

  async request(userId: string, id: string, dto: CoffeeMeetupRequestDto) {
    const meetup = await this.liveMeetup(id);
    if (meetup.organizerId === userId) throw new BadRequestException('Organizer cannot join own meetup');
    if (seats(meetup) >= meetup.maxParticipants || meetup.status === 'full') throw new BadRequestException('Meetup full');
    const existing = await this.prisma.coffeeMeetupRequest.findUnique({ where: { meetupId_requesterId: { meetupId: id, requesterId: userId } } });
    if (existing && ['pending', 'accepted'].includes(existing.status)) throw new BadRequestException('Active request already exists');
    existing ? await this.prisma.coffeeMeetupRequest.update({ where: { id: existing.id }, data: { status: 'pending', message: dto.message || null, acceptedAt: null, withdrawnAt: null, rejectedAt: null } }) : await this.prisma.coffeeMeetupRequest.create({ data: { meetupId: id, requesterId: userId, message: dto.message || null } });
    return this.detail(id, userId);
  }

  async withdraw(userId: string, requestId: string) {
    const meetupId = await this.requestTransaction(async (tx) => {
      const request = await this.findVisibleRequest(tx, requestId);
      if (request.requesterId !== userId) throw new ForbiddenException();
      if (request.status === 'withdrawn') return request.meetupId;
      if (request.status !== 'pending' && request.status !== 'accepted') {
        throw new BadRequestException('Request cannot be withdrawn');
      }

      const now = new Date();
      await tx.coffeeMeetupRequest.update({ where: { id: requestId }, data: { status: 'withdrawn', withdrawnAt: now } });
      const { meetup } = request;
      const remainingParticipants = seats(meetup) - Number(request.status === 'accepted');
      if (meetup.status === 'full' && meetup.endsAt > now && remainingParticipants < meetup.maxParticipants) {
        await tx.coffeeMeetup.update({ where: { id: meetup.id }, data: { status: 'open' } });
      }
      return request.meetupId;
    });
    return this.detail(meetupId, userId);
  }

  accept(userId: string, requestId: string) { return this.decideRequest(userId, requestId, 'accepted'); }
  reject(userId: string, requestId: string) { return this.decideRequest(userId, requestId, 'rejected'); }
  async cancel(userId: string, id: string) { await this.ownerMeetup(userId, id); return this.patchStatus(id, 'cancelled'); }
  async complete(userId: string, id: string) { await this.ownerMeetup(userId, id); return this.patchStatus(id, 'completed'); }

  async report(userId: string, id: string, dto: ReportCoffeeMeetupDto) {
    const meetup = await this.prisma.coffeeMeetup.findFirst({ where: { id, isHidden: false }, select: { id: true } });
    if (!meetup) throw new NotFoundException('Coffee meetup not found');
    await this.prisma.coffeeMeetupReport.upsert({ where: { meetupId_reporterId: { meetupId: id, reporterId: userId } }, create: { meetupId: id, reporterId: userId, reason: dto.reason, note: dto.note || null }, update: { reason: dto.reason, note: dto.note || null, resolvedAt: null, resolvedById: null } });
    return { reported: true };
  }

  async adminList(dto: AdminCoffeeMeetupListDto) {
    const page = pageValue(dto.page, 1); const limit = pageValue(dto.limit, 12, 100);
    return this.page({ ...(dto.status ? { status: dto.status } : {}), ...(dto.hidden !== undefined ? { isHidden: dto.hidden } : {}), ...(dto.reported ? { reports: { some: { resolvedAt: null } } } : {}), ...searchWhere(dto.search, true) }, page, limit, undefined, undefined, undefined, true);
  }

  async adminDetail(id: string) {
    const meetup = await this.prisma.coffeeMeetup.findUnique({ where: { id }, include: { ...this.detailInclude(true), reports: { include: { reporter: { select: adminUserSelect } }, orderBy: { createdAt: 'desc' } } } });
    if (!meetup) throw new NotFoundException('Coffee meetup not found');
    return serializeAdminMeetup(meetup, true);
  }

  async adminPatch(adminId: string, id: string, dto: any) {
    await this.adminDetail(id); const now = new Date();
    const data: any = { ...(dto.adminNote !== undefined ? { adminNote: dto.adminNote || null } : {}), ...(dto.isHidden !== undefined ? { isHidden: dto.isHidden, hiddenAt: dto.isHidden ? now : null, hiddenById: dto.isHidden ? adminId : null } : {}), ...(dto.status ? statusData(dto.status, now) : {}) };
    const [meetup] = await this.prisma.$transaction([this.prisma.coffeeMeetup.update({ where: { id }, data, include: { cafe: { select: cafeSelect }, organizer: { select: adminUserSelect }, _count: { select: adminCounts } } }), ...(dto.resolveReports ? [this.prisma.coffeeMeetupReport.updateMany({ where: { meetupId: id, resolvedAt: null }, data: { resolvedAt: now, resolvedById: adminId } })] : [])]);
    return serializeAdminMeetup(meetup);
  }

  private async page(where: any, page: number, limit: number, distances?: Map<string, number>, orderedIds?: string[], totalOverride?: number, admin = false) {
    const [rows, total] = await Promise.all([
      this.prisma.coffeeMeetup.findMany({ where, ...(orderedIds ? {} : { skip: (page - 1) * limit, take: limit }), orderBy: orderedIds ? undefined : [{ startsAt: 'asc' }, { id: 'asc' }], include: { cafe: { select: cafeSelect }, organizer: { select: admin ? adminUserSelect : userSelect }, requests: { select: { status: true } }, _count: { select: admin ? adminCounts : counts } } }),
      totalOverride ?? this.prisma.coffeeMeetup.count({ where: orderedIds ? { id: { in: orderedIds } } : where }),
    ]);
    const order = orderedIds ? new Map(orderedIds.map((id, index) => [id, index])) : null;
    const data = rows.sort((a, b) => (order ? (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) : 0)).map((meetup) => {
      const result = admin ? serializeAdminMeetup(meetup) : serializeMeetup(meetup);
      const distanceKm = distances?.get(meetup.id);
      return distanceKm == null || !result.cafe ? result : { ...result, distanceKm, distanceMode: 'straight' as const, cafe: { ...result.cafe, distanceKm, distanceMode: 'straight' as const } };
    });
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  private detailInclude(admin = false) { return { cafe: { select: cafeSelect }, organizer: { select: admin ? adminUserSelect : userSelect }, requests: { include: { requester: { select: admin ? adminUserSelect : userSelect } }, orderBy: { createdAt: 'desc' as const } }, _count: { select: admin ? adminCounts : counts } }; }

  private async resolvePlace(dto: CreateCoffeeMeetupDto | UpdateCoffeeMeetupDto) {
    const place = dto.place; const legacyCafeId = dto.cafeId;
    if (place?.kind === 'cafe') {
      if (!place.cafeId || (legacyCafeId && legacyCafeId !== place.cafeId) || place.name || place.googleMapsUrl) throw new BadRequestException('Invalid cafe place');
      await this.ensurePublishedCafe(place.cafeId); return { cafeId: place.cafeId, externalPlaceName: null, externalGoogleMapsUrl: null };
    }
    if (place?.kind === 'external') {
      const googleMapsUrl = place.googleMapsUrl && normalizeGoogleMapsUrl(place.googleMapsUrl);
      if (legacyCafeId || !place.name || !googleMapsUrl || place.cafeId) throw new BadRequestException('Invalid external place');
      return { cafeId: null, externalPlaceName: place.name.trim(), externalGoogleMapsUrl: googleMapsUrl };
    }
    if (legacyCafeId) { await this.ensurePublishedCafe(legacyCafeId); return { cafeId: legacyCafeId, externalPlaceName: null, externalGoogleMapsUrl: null }; }
    throw new BadRequestException('Exactly one place is required');
  }

  private async ensurePublishedCafe(cafeId: string) {
    const cafe = await this.prisma.cafe.findFirst({ where: { id: cafeId, isPublished: true }, select: { id: true } });
    if (!cafe) throw new NotFoundException('Cafe not found');
  }
  private async decideRequest(userId: string, requestId: string, status: 'accepted' | 'rejected') {
    const meetupId = await this.requestTransaction(async (tx) => {
      const request = await this.findVisibleRequest(tx, requestId);
      const { meetup } = request;
      if (meetup.organizerId !== userId) throw new ForbiddenException();
      if (request.status !== 'pending') throw new BadRequestException('Request not pending');
      const now = new Date();
      if (status === 'accepted') {
        if (meetup.status === 'full' || seats(meetup) >= meetup.maxParticipants) {
          throw new ConflictException('Meetup full');
        }
        if (meetup.status !== 'open' || meetup.endsAt <= now) {
          throw new ConflictException('Meetup is no longer open');
        }
      }
      await tx.coffeeMeetupRequest.update({
        where: { id: requestId },
        data: { status, acceptedAt: status === 'accepted' ? now : null, rejectedAt: status === 'rejected' ? now : null },
      });
      if (status === 'accepted' && seats(meetup) + 1 >= meetup.maxParticipants) {
        await tx.coffeeMeetup.update({ where: { id: meetup.id }, data: { status: 'full' } });
      }
      return request.meetupId;
    });
    return this.detail(meetupId, userId);
  }

  private async findVisibleRequest(tx: Prisma.TransactionClient, id: string) {
    const request = await tx.coffeeMeetupRequest.findUnique({
      where: { id },
      include: { meetup: { include: { _count: { select: counts } } } },
    });
    if (!request || request.meetup.isHidden) throw new NotFoundException('Request not found');
    return request;
  }

  private async requestTransaction<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
        if (attempt === 2) throw new ConflictException('Meetup changed concurrently');
      }
    }
  }

  private async ownerMeetup(userId: string, id: string) { const meetup = await this.prisma.coffeeMeetup.findUnique({ where: { id, isHidden: false }, include: { _count: { select: counts } } }); if (!meetup) throw new NotFoundException('Coffee meetup not found'); if (meetup.organizerId !== userId) throw new ForbiddenException(); return meetup; }
  private async liveMeetup(id: string) { const meetup = await this.prisma.coffeeMeetup.findFirst({ where: { id, isHidden: false, status: { in: ['open', 'full'] }, endsAt: { gt: new Date() } }, include: { _count: { select: counts } } }); if (!meetup) throw new NotFoundException('Coffee meetup not found'); return meetup; }
  private async patchStatus(id: string, status: string) { const meetup = await this.prisma.coffeeMeetup.update({ where: { id }, data: statusData(status, new Date()), include: { cafe: { select: cafeSelect }, organizer: { select: userSelect }, _count: { select: counts } } }); return serializeMeetup(meetup); }
  private assertTimes(startsAt: Date, endsAt: Date) { if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt <= new Date()) throw new BadRequestException('Start must be in the future'); if (endsAt <= startsAt) throw new BadRequestException('End must be after start'); }
}
