import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type {} from 'multer';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateCommunitySubmissionDto } from './dto/create-community-submission.dto';
import { SubmissionMediaService } from './submission-media.service';
import { lockDraft, mergeDraftMedia, validatePayloadMedia } from './submission-media.helpers';
import { CreateSubmissionDto } from './dto/create-submission.dto';

type UploadedFile = Express.Multer.File;

const MAX_OWNER_GALLERY_IMAGES = 12;
const OWNER_GALLERY_IMAGE_LIMIT_MESSAGE = `Owner gallery allows at most ${MAX_OWNER_GALLERY_IMAGES} images`;
const DEFAULT_COVER_IMAGE_CROP = { x: 50, y: 50 };

function payloadObject(value: unknown) {
  return typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
}

function filledString(value: unknown) {
  return typeof value === 'string' && Boolean(value.trim());
}

function imageCount(payload: unknown) {
  const images = payloadObject(payload).images;
  return Array.isArray(images) ? images.length : 0;
}

function validateOwnerGalleryImageCount(submissionType: string | undefined, payload: unknown) {
  if (submissionType === 'owner' && imageCount(payload) > MAX_OWNER_GALLERY_IMAGES)
    throw new BadRequestException(OWNER_GALLERY_IMAGE_LIMIT_MESSAGE);
}

async function mapLimit<T, U>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<U>,
) {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  let firstError: unknown;
  async function worker() {
    while (nextIndex < items.length && !firstError) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        firstError = error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (firstError) throw firstError;
  return results;
}

function validateOwnerPayload(submission: {
  name: string;
  address: string | null;
  googleMapsUrl: string | null;
  payload: unknown;
}) {
  const payload = payloadObject(submission.payload);
  validateOwnerGalleryImageCount('owner', payload);
  const missing = [
    filledString(payload.name) || filledString(submission.name) ? null : 'name',
    Array.isArray(payload.images) && payload.images.length > 0 ? null : 'images',
    filledString(payload.address) ||
    filledString(payload.googleMapsUrl) ||
    filledString(submission.address) ||
    filledString(submission.googleMapsUrl)
      ? null
      : 'location',
    filledString(payload.openingTime) ? null : 'openingTime',
    filledString(payload.closingTime) ? null : 'closingTime',
  ].filter(Boolean);
  if (missing.length)
    throw new BadRequestException(`Missing required owner payload: ${missing.join(', ')}`);
}

@Injectable()
export class SubmissionsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private media: SubmissionMediaService,
  ) {}

  async create(userId: string, dto: CreateSubmissionDto) {
    validatePayloadMedia(dto.payload);
    const submissionType = dto.submissionType ?? 'community';
    validateOwnerGalleryImageCount(submissionType, dto.payload);
    return this.prisma.cafeSubmission.create({
      data: {
        submittedById: userId,
        submissionType,
        status: submissionType === 'owner' ? 'draft' : 'pending',
        name: dto.name,
        address: dto.address,
        googleMapsUrl: dto.googleMapsUrl,
        note: dto.note,
        payload: (dto.payload ?? null) as Prisma.InputJsonValue,
      },
    });
  }

  async createCommunity(
    userId: string | undefined,
    dto: CreateCommunitySubmissionDto,
    files: UploadedFile[],
  ) {
    const id = randomUUID();
    const uploadedUrls: string[] = [];
    try {
      const images = await mapLimit(files, 2, async (file) => {
        const url = await this.storage.uploadImage(file, `submissions/${id}/images`);
        uploadedUrls.push(url);
        return url;
      });
      const payload = {
        images,
        imageOrientations: images.map(() => 'unknown'),
        coverImage: images[0] ?? null,
        coverImageCrop: DEFAULT_COVER_IMAGE_CROP,
      };

      return await this.prisma.cafeSubmission.create({
        data: {
          id,
          ...(userId ? { submittedById: userId } : {}),
          submissionType: 'community',
          status: 'pending',
          name: dto.name,
          googleMapsUrl: dto.googleMapsUrl,
          note: dto.note,
          payload: payload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      await Promise.allSettled(uploadedUrls.map((url) => this.storage.deleteImage(url)));
      throw error;
    }
  }

  async update(userId: string, id: string, dto: CreateSubmissionDto) {
    return this.prisma.$transaction(async (tx) => {
      const submission = await lockDraft(tx, userId, id);
      validatePayloadMedia(dto.payload);
      validateOwnerGalleryImageCount(submission.submissionType, dto.payload);
      const payload = mergeDraftMedia(submission.payload, dto.payload);
      validateOwnerGalleryImageCount(submission.submissionType, payload);
      return tx.cafeSubmission.update({
        where: { id },
        data: {
          name: dto.name,
          submissionType: submission.submissionType,
          address: dto.address,
          googleMapsUrl: dto.googleMapsUrl,
          note: dto.note,
          payload: payload as Prisma.InputJsonValue,
        },
      });
    });
  }

  uploadImage(userId: string, id: string, file: UploadedFile, field: 'images' | 'menuImages') {
    return this.media.uploadImages(userId, id, [file], field);
  }

  uploadImages(userId: string, id: string, files: UploadedFile[], field: 'images' | 'menuImages') {
    return this.media.uploadImages(userId, id, files, field);
  }

  deleteImage(userId: string, id: string, url: string) {
    return this.media.deleteImage(userId, id, url);
  }

  async submit(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const submission = await lockDraft(tx, userId, id);
      if (await tx.submissionAsset.count({ where: { submissionId: id, status: 'delete_pending' } }))
        throw new BadRequestException(
          'Image deletion is pending; retry deletion before submitting',
        );
      if (submission.submissionType === 'owner') validateOwnerPayload(submission);
      return tx.cafeSubmission.update({ where: { id }, data: { status: 'pending' } });
    });
  }

  async getMe(userId: string) {
    return this.prisma.cafeSubmission.findMany({
      where: { submittedById: userId, isHidden: false },
      orderBy: { createdAt: 'desc' },
      include: {
        createdCafe: {
          select: {
            id: true,
            name: true,
            slug: true,
            address: true,
            district: true,
            coverImage: true,
            isPublished: true,
          },
        },
      },
    });
  }
}
