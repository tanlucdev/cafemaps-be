import { SubmissionsService } from '../src/submissions/submissions.service';
import { SubmissionMediaService } from '../src/submissions/submission-media.service';
export function serviceFor(prisma: any, storage: any) {
  prisma.$queryRaw ??= async () => [];
  prisma.$transaction ??= async (fn: any) => fn(prisma);
  prisma.submissionAsset ??= { createMany: async () => ({}), count: async () => 0 };
  return new SubmissionsService(prisma, storage, new SubmissionMediaService(prisma, storage));
}
