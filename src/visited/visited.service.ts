import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { serializeLocalizedCafe } from '../cafes/cafe.mapper';

type VisitedCafeRow = {
  id: string;
  cafeId: string;
  createdAt: Date;
  cafe: Record<string, any>;
};

type MarkVisitedRow = {
  cafeId: string;
};

@Injectable()
export class VisitedService {
  constructor(private prisma: PrismaService) {}

  async getVisited(userId: string, locale?: string) {
    const rows = await this.prisma.$queryRaw<VisitedCafeRow[]>`
      SELECT
        v.id,
        v.cafe_id AS "cafeId",
        v.created_at AS "createdAt",
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'nameEn', c.name_en,
          'slug', c.slug,
          'address', c.address,
          'addressEn', c.address_en,
          'district', c.district,
          'districtEn', c.district_en,
          'priceMin', c.price_min,
          'priceMax', c.price_max,
          'oneLiner', c.one_liner,
          'oneLinerEn', c.one_liner_en,
          'parkingLocation', c.parking_location,
          'parkingLocationEn', c.parking_location_en,
          'vibes', c.vibes,
          'vibesEn', c.vibes_en,
          'purposes', c.purposes,
          'purposesEn', c.purposes_en,
          'amenities', c.amenities,
          'amenitiesEn', c.amenities_en,
          'tags', c.tags,
          'tagsEn', c.tags_en,
          'coverImage', c.cover_image,
          'coverImageCrop', c.cover_image_crop,
          'lat', ST_Y(c.location::geometry),
          'lng', ST_X(c.location::geometry)
        ) AS cafe
      FROM visited_cafes v
      JOIN cafes c ON c.id = v.cafe_id
      WHERE v.user_id = ${userId}::uuid
        AND c.is_published = true
        AND c.is_hidden = false
        AND c.location IS NOT NULL
      ORDER BY v.created_at DESC
    `;

    return rows.map((row) => ({
      id: row.id,
      cafeId: row.cafeId,
      visitedAt: row.createdAt,
      createdAt: row.createdAt,
      cafe: serializeLocalizedCafe(row.cafe, locale),
    }));
  }

  async mark(userId: string, cafeId: string) {
    const [row] = await this.prisma.$queryRaw<MarkVisitedRow[]>`
      WITH cafe AS (
        SELECT id
        FROM cafes
        WHERE id = ${cafeId}::uuid
          AND is_published = true
          AND is_hidden = false
      ),
      inserted AS (
        INSERT INTO visited_cafes (user_id, cafe_id)
        SELECT ${userId}::uuid, id
        FROM cafe
        ON CONFLICT (user_id, cafe_id) DO NOTHING
        RETURNING cafe_id
      )
      SELECT id AS "cafeId"
      FROM cafe
    `;
    if (!row) throw new NotFoundException('Cafe not found');

    return { cafeId, visited: true };
  }

  async unmark(userId: string, cafeId: string) {
    await this.prisma.visitedCafe.deleteMany({ where: { userId, cafeId } });
    return { cafeId, visited: false };
  }
}
