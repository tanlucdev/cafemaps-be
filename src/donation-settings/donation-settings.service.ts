import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import sharp = require('sharp');
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateDonationSettingsDto } from './donation-settings.dto';

const select = {
  enabled: true,
  qrImageUrl: true,
  titleVi: true,
  titleEn: true,
  descriptionVi: true,
  descriptionEn: true,
} as const;

const defaults = {
  enabled: true,
  qrImageUrl: null,
  titleVi: null,
  titleEn: null,
  descriptionVi: null,
  descriptionEn: null,
};

@Injectable()
export class DonationSettingsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async get() {
    return (
      (await this.prisma.donationSettings.findUnique({ where: { id: 1 }, select })) ?? defaults
    );
  }

  async update(dto: UpdateDonationSettingsDto, file?: Express.Multer.File) {
    let qrImageUrl: string | undefined;
    if (file) {
      try {
        const metadata = await sharp(file.buffer, { limitInputPixels: 4096 * 4096 }).metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) > 1) {
          throw new Error('Unsupported image');
        }
      } catch {
        throw new BadRequestException(
          'QR must be a JPEG, PNG or WebP image, at most 16 megapixels',
        );
      }
      qrImageUrl = await this.storage.uploadImage(
        { ...file, originalname: `${randomUUID()}.png` },
        'donation',
      );
    }
    const data = { ...dto, ...(qrImageUrl ? { qrImageUrl } : {}) };
    // ponytail: Keep uploads after failed writes; a timeout may follow a committed save.
    // Add orphan cleanup only after checking database references.
    return this.prisma.donationSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
      select,
    });
  }
}
