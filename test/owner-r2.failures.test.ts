import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { SubmissionMediaService } from '../src/submissions/submission-media.service';

const file = { originalname: 'one.png' } as Express.Multer.File;
test('transaction failure after upload compensates every created object and preserves DB error on cleanup failure', async () => {
  const deleted: string[] = [],
    logs: unknown[] = [];
  const original = Logger.prototype.error;
  Logger.prototype.error = (message) => {
    logs.push(message);
  };
  try {
    const service = new SubmissionMediaService(
      {
        cafeSubmission: { findFirst: async () => ({ submissionType: 'owner', payload: {} }) },
        $transaction: async () => {
          throw new Error('database failure');
        },
      } as any,
      {
        uploadImage: async () => 'created.webp',
        deleteImage: async (url: string) => {
          deleted.push(url);
          throw new Error('cleanup failure');
        },
      } as any,
    );
    await assert.rejects(
      () => service.uploadImages('owner', 'draft', [file], 'images'),
      /database failure/,
    );
    assert.deepEqual(deleted, ['created.webp']);
    assert.equal((logs[0] as any).type, 'submission.upload.cleanup.failed');
    assert.equal((logs[0] as any).id, 'draft');
  } finally {
    Logger.prototype.error = original;
  }
});

test('partial batch waits for running uploads before compensating; never starts remaining files', async () => {
  const created: string[] = [],
    deleted: string[] = [];
  const service = new SubmissionMediaService(
    {
      cafeSubmission: { findFirst: async () => ({ submissionType: 'owner', payload: {} }) },
    } as any,
    {
      uploadImage: async (input: any) => {
        if (input.originalname === 'bad') throw new Error('R2 timeout');
        await new Promise((resolve) => setTimeout(resolve, 15));
        created.push(input.originalname);
        return `${input.originalname}.webp`;
      },
      deleteImage: async (url: string) => {
        deleted.push(url);
      },
    } as any,
  );
  await assert.rejects(
    () =>
      service.uploadImages(
        'owner',
        'draft',
        [file, { originalname: 'bad' }, { originalname: 'never' }] as any,
        'images',
      ),
    /R2 timeout/,
  );
  assert.deepEqual(created, ['one.png']);
  assert.deepEqual(deleted, ['one.png.webp']);
});
