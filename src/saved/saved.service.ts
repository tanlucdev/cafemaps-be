import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SaveCafeDto } from './dto/save-cafe.dto';
import { serializeLocalizedCafe } from '../cafes/cafe.mapper';

@Injectable()
export class SavedService {
  constructor(private prisma: PrismaService) {}

  private collectionName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('Collection name is required');
    }
    return trimmed.slice(0, 40);
  }

  async getSaved(userId: string, locale?: string) {
    const saved = await this.prisma.savedCafe.findMany({
      where: { userId, cafe: { isPublished: true, isHidden: false } },
      include: {
        cafe: {
          select: {
            id: true,
            name: true,
            nameEn: true,
            slug: true,
            address: true,
            addressEn: true,
            district: true,
            districtEn: true,
            priceMin: true,
            priceMax: true,
            oneLiner: true,
            oneLinerEn: true,
            parkingLocation: true,
            parkingLocationEn: true,
            vibes: true,
            vibesEn: true,
            purposes: true,
            purposesEn: true,
            amenities: true,
            amenitiesEn: true,
            tags: true,
            tagsEn: true,
            coverImage: true,
            coverImageCrop: true,
            isFeatured: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return saved.map((item) => ({
      ...item,
      cafe: serializeLocalizedCafe(item.cafe, locale),
    }));
  }

  async save(userId: string, dto: SaveCafeDto) {
    const cafe = await this.prisma.cafe.findFirst({
      where: { id: dto.cafeId, isPublished: true, isHidden: false },
    });
    if (!cafe) {
      throw new NotFoundException('Cafe not found');
    }
    const collectionName = dto.collectionName ? this.collectionName(dto.collectionName) : null;
    if (collectionName) {
      await this.ensureCollection(userId, collectionName);
    }

    try {
      return await this.prisma.savedCafe.create({
        data: {
          userId,
          cafeId: dto.cafeId,
          collectionName,
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException('Cafe is already saved');
      }
      throw e;
    }
  }

  async remove(userId: string, cafeId: string) {
    const saved = await this.prisma.savedCafe.findUnique({
      where: { userId_cafeId: { userId, cafeId } },
    });

    if (!saved) {
      throw new NotFoundException('Cafe not found in saved list');
    }

    return this.prisma.savedCafe.delete({
      where: { userId_cafeId: { userId, cafeId } },
    });
  }

  async getCollections(userId: string) {
    const collections = await this.prisma.$queryRaw<{ name: string; createdAt: Date | null }[]>`
      SELECT name, "createdAt"
      FROM (
        SELECT name, created_at AS "createdAt"
        FROM saved_collections
        WHERE user_id = ${userId}::uuid
        UNION ALL
        SELECT collection_name, NULL
        FROM saved_cafes
        WHERE user_id = ${userId}::uuid AND collection_name IS NOT NULL
        GROUP BY collection_name
      ) names
      ORDER BY ("createdAt" IS NOT NULL) DESC, name ASC
    `;

    const names = new Map<string, { name: string; createdAt?: Date }>();
    const usedNames = new Set<string>();
    for (const { name: original, createdAt } of collections) {
      if (createdAt) {
        const key = original.toLowerCase();
        if (!names.has(key)) names.set(key, { name: original, createdAt });
        continue;
      }

      const name = original.trim();
      const key = name.toLowerCase();
      if (!name || usedNames.has(key)) continue;
      usedNames.add(key);
      names.set(key, { name });
    }

    return Array.from(names.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async createCollection(userId: string, rawName: string) {
    const name = this.collectionName(rawName);
    return this.prisma.savedCollection.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name },
      select: { name: true, createdAt: true },
    });
  }

  async renameCollection(userId: string, rawOldName: string, rawNewName: string) {
    const oldName = this.collectionName(decodeURIComponent(rawOldName));
    const newName = this.collectionName(rawNewName);

    return this.prisma.$transaction(async (tx) => {
      const collection = await tx.savedCollection.upsert({
        where: { userId_name: { userId, name: newName } },
        update: {},
        create: { userId, name: newName },
        select: { name: true, createdAt: true },
      });
      await tx.savedCafe.updateMany({
        where: { userId, collectionName: oldName },
        data: { collectionName: newName },
      });
      if (oldName !== newName) {
        await tx.savedCollection.deleteMany({ where: { userId, name: oldName } });
      }
      return collection;
    });
  }

  async deleteCollection(userId: string, rawName: string) {
    const name = this.collectionName(decodeURIComponent(rawName));

    await this.prisma.$transaction([
      this.prisma.savedCafe.updateMany({
        where: { userId, collectionName: name },
        data: { collectionName: null },
      }),
      this.prisma.savedCollection.deleteMany({ where: { userId, name } }),
    ]);

    return { deleted: true };
  }

  async moveToCollection(userId: string, cafeId: string, rawName?: string | null) {
    const collectionName = rawName == null ? null : this.collectionName(rawName);
    const saved = await this.prisma.savedCafe.findUnique({
      where: { userId_cafeId: { userId, cafeId } },
    });

    if (!saved) {
      throw new NotFoundException('Cafe not found in saved list');
    }

    if (collectionName) {
      await this.ensureCollection(userId, collectionName);
    }

    return this.prisma.savedCafe.update({
      where: { userId_cafeId: { userId, cafeId } },
      data: { collectionName },
    });
  }

  private ensureCollection(userId: string, name: string) {
    return this.prisma.savedCollection.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name },
    });
  }
}
