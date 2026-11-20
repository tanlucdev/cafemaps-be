import { BadRequestException, FileValidator, applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type {} from 'multer';
type UploadedFile = Express.Multer.File;
const ACCEPTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'image/avif',
  'image/tiff',
]);
const ACCEPTED_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|heic|heics|heif|heifs|avif|tiff?)$/i;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 40 * 1024 * 1024;
export const MAX_BATCH_IMAGES = 12;
export const MAX_COMMUNITY_IMAGES = 8;

export class ImageUploadFileValidator extends FileValidator<Record<string, never>> {
  isValid(file?: UploadedFile): boolean {
    if (!file) return false;
    return (
      ACCEPTED_IMAGE_MIME_TYPES.has(file.mimetype) ||
      ACCEPTED_IMAGE_EXTENSIONS.test(file.originalname)
    );
  }

  buildErrorMessage(): string {
    return 'File must be a JPEG, PNG, WebP, HEIC, HEIF, AVIF, or TIFF image';
  }
}

export function validateBatchFiles(files: UploadedFile[]) {
  const validator = new ImageUploadFileValidator({});
  if (!files.length) throw new BadRequestException('At least one file is required');
  if (files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES)
    throw new BadRequestException('Batch is too large');
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('File is too large');
    if (!validator.isValid(file)) throw new BadRequestException(validator.buildErrorMessage());
  }
}

export function validateCommunityFiles(files: UploadedFile[]) {
  const validator = new ImageUploadFileValidator({});
  if (files.length > MAX_COMMUNITY_IMAGES)
    throw new BadRequestException(`At most ${MAX_COMMUNITY_IMAGES} images are allowed`);
  if (files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES)
    throw new BadRequestException('Batch is too large');
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('File is too large');
    if (!validator.isValid(file)) throw new BadRequestException(validator.buildErrorMessage());
  }
}

export function UploadResponse() {
  return applyDecorators(
    ApiResponse({
      status: 201,
      description: 'Existing submission fields plus uploadedUrls in request order',
      schema: {
        type: 'object',
        required: ['id', 'payload', 'uploadedUrls'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          payload: { type: 'object', additionalProperties: true },
          uploadedUrls: { type: 'array', items: { type: 'string', format: 'uri' } },
        },
      },
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid image, UUID, batch or gallery quota exceeded',
    }),
    ApiResponse({ status: 401, description: 'JWT required' }),
    ApiResponse({ status: 404, description: 'Draft not owned by user or already submitted' }),
    ApiResponse({ status: 413, description: 'File exceeds 20 MiB' }),
    ApiResponse({ status: 502, description: 'Storage unavailable' }),
    ApiResponse({ status: 504, description: 'Storage timeout; reconcile draft before retry' }),
  );
}
