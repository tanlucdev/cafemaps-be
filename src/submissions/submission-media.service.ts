import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { checkQuota, lockDraft, payloadObject } from './submission-media.helpers';
import type {} from 'multer';

@Injectable()
export class SubmissionMediaService {
  private readonly logger = new Logger(SubmissionMediaService.name);
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async uploadImages(
    userId: string,
    id: string,
    files: Express.Multer.File[],
    field: 'images' | 'menuImages',
  ) {
    const submission = await this.prisma.cafeSubmission.findFirst({
      where: { id, submittedById: userId, status: 'draft', isHidden: false },
    });
    if (!submission) throw new NotFoundException(`Submission not found: ${id}`);
    checkQuota(submission, files.length, field);
    const uploaded: string[] = [];
    const urls = new Array<string>(files.length);
    let next = 0;
    let failure: unknown;
    try {
      await Promise.all(
        Array.from({ length: Math.min(2, files.length) }, async () => {
          while (next < files.length && !failure) {
            const index = next++;
            try {
              const url = await this.storage.uploadImage(
                files[index],
                `submissions/${id}/${field}`,
              );
              uploaded.push(url);
              urls[index] = url;
            } catch (error) {
              const message = error?.message ?? '';
              failure = message.startsWith('Image conversion failed:')
                ? new BadRequestException('File content is not a decodable image')
                : error;
            }
          }
        }),
      );
      if (failure) throw failure;
      return await this.prisma.$transaction(async (tx) => {
        const latest = await lockDraft(tx, userId, id);
        checkQuota(latest, urls.length, field);
        const payload = payloadObject(latest.payload);
        payload[field] = [...(payload[field] ?? []), ...urls];
        if (field === 'images') {
          payload.imageOrientations = payload.images.map(
            (_: string, index: number) => payload.imageOrientations?.[index] ?? 'unknown',
          );
          payload.coverImage ??= payload.images[0];
          payload.coverImageCrop ??= { x: 50, y: 50 };
        }
        await tx.submissionAsset.createMany({
          data: urls.map((url) => ({
            submissionId: id,
            publicId: url,
            secureUrl: url,
            field,
            status: 'persisted',
            expiresAt: new Date(),
          })),
        });
        const saved = await tx.cafeSubmission.update({
          where: { id },
          data: { payload: payload as Prisma.InputJsonValue },
        });
        return { ...saved, uploadedUrls: urls };
      });
    } catch (error) {
      await Promise.all(
        uploaded.map(async (url) => {
          try {
            await this.storage.deleteImage(url);
          } catch (cleanupError) {
            this.logger.error({
              type: 'submission.upload.cleanup.failed',
              id,
              url,
              error: String(cleanupError),
            });
          }
        }),
      );
      throw error;
    }
  }

  async deleteImage(userId: string, id: string, url: string) {
    if (typeof url !== 'string' || !url) throw new BadRequestException('url is required');
    const { submission, asset } = await this.prisma.$transaction(async (tx) => {
      const submission = await lockDraft(tx, userId, id);
      const asset = await tx.submissionAsset.findFirst({
        where: { submissionId: id, secureUrl: url },
      });
      if (!asset) throw new NotFoundException('Asset does not belong to this draft');
      if (asset.field !== 'images' && asset.field !== 'menuImages')
        throw new BadRequestException('Invalid asset field');
      const payload = payloadObject(submission.payload);
      const urls: string[] = payload[asset.field] ?? [];
      const index = urls.indexOf(url);
      payload[asset.field] = urls.filter((value) => value !== url);
      if (asset.field === 'images') {
        payload.imageOrientations = urls.flatMap((value, i) =>
          value === url ? [] : [payload.imageOrientations?.[i] ?? 'unknown'],
        );
        if (payload.coverImage === url || !payload.images.includes(payload.coverImage)) {
          payload.coverImage = payload.images[0] ?? null;
          payload.coverImageCrop = payload.coverImage ? { x: 50, y: 50 } : null;
        }
      }
      await tx.submissionAsset.update({
        where: { id: asset.id },
        data: { status: 'delete_pending' },
      });
      const saved =
        index < 0
          ? submission
          : await tx.cafeSubmission.update({
              where: { id },
              data: { payload: payload as Prisma.InputJsonValue },
            });
      return { submission: saved, asset };
    });
    try {
      await this.storage.deleteImage(asset.secureUrl);
    } catch (error) {
      this.logger.error({
        type: 'submission.delete.pending',
        id,
        assetId: asset.id,
        error: String(error),
      });
      throw error;
    }
    await this.prisma.submissionAsset.deleteMany({
      where: { id: asset.id, status: 'delete_pending' },
    });
    return submission;
  }
}
