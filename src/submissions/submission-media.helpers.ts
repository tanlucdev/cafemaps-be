import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function payloadObject(value: unknown): Record<string, any> {
  return typeof value === 'object' && value && !Array.isArray(value) ? { ...value } : {};
}

export async function lockDraft(tx: Prisma.TransactionClient, userId: string, id: string) {
  await tx.$queryRaw(
    Prisma.sql`SELECT 1 FROM "cafe_submissions" WHERE "id" = CAST(${id} AS uuid) FOR UPDATE`,
  );
  const submission = await tx.cafeSubmission.findFirst({
    where: { id, submittedById: userId, status: 'draft', isHidden: false },
  });
  if (!submission) throw new NotFoundException(`Submission not found: ${id}`);
  return submission;
}

export function checkQuota(
  submission: { submissionType: string; payload: unknown },
  count: number,
  field: string,
) {
  if (
    field === 'images' &&
    submission.submissionType === 'owner' &&
    (payloadObject(submission.payload).images ?? []).length + count > 12
  )
    throw new BadRequestException('Owner gallery allows at most 12 images');
}

// Membership is changed only by media endpoints; a stale save may reorder, never resurrect or discard URLs.
export function mergeDraftMedia(current: unknown, incoming: unknown) {
  const latest = payloadObject(current);
  const patch = payloadObject(incoming);
  const payload = { ...latest, ...patch };
  for (const field of ['images', 'menuImages']) {
    const urls: string[] = latest[field] ?? [];
    const requested: string[] = Array.isArray(patch[field]) ? patch[field] : urls;
    payload[field] = [...new Set([...requested.filter((url) => urls.includes(url)), ...urls])];
  }
  payload.imageOrientations = payload.images.map((url: string) => {
    const index = Array.isArray(patch.images) ? patch.images.indexOf(url) : -1;
    return (
      (index >= 0 ? patch.imageOrientations?.[index] : undefined) ??
      latest.imageOrientations?.[(latest.images ?? []).indexOf(url)] ??
      'unknown'
    );
  });
  const cover = payload.images.includes(patch.coverImage)
    ? patch.coverImage
    : payload.images.includes(latest.coverImage)
      ? latest.coverImage
      : (payload.images[0] ?? null);
  payload.coverImage = cover;
  payload.coverImageCrop =
    cover === patch.coverImage
      ? (patch.coverImageCrop ?? { x: 50, y: 50 })
      : cover === latest.coverImage
        ? latest.coverImageCrop
        : cover
          ? { x: 50, y: 50 }
          : null;
  return payload;
}

export function validatePayloadMedia(value: unknown) {
  const payload = payloadObject(value);
  for (const field of ['images', 'menuImages', 'imageOrientations']) {
    if (
      payload[field] !== undefined &&
      (!Array.isArray(payload[field]) ||
        !payload[field].every((url: unknown) => typeof url === 'string'))
    )
      throw new BadRequestException(`${field} must be an array of strings`);
  }
}
