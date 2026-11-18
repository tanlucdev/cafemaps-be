import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { CafesService } from '../src/cafes/cafes.service';

test('Prisma maps imageSourceUsernames to the existing database column', () => {
  const cafe = Prisma.dmmf.datamodel.models.find((model) => model.name === 'Cafe');
  const field = cafe?.fields.find((field) => field.name === 'imageSourceUsernames');
  assert.equal(field?.dbName, 'image_source_usernames');
  assert.equal(field?.type, 'String');
  assert.equal(field?.isList, true);
  assert.deepEqual(field?.default, []);
});

test('detail preserves recorded image sources and empty sources in both locales', async () => {
  for (const imageSourceUsernames of [['cafearoundsaigon'], []]) {
    for (const locale of ['vi', 'en']) {
      const prisma = {
        cafe: {
          findFirst: async (args: any) => {
            assert.equal(args.select, undefined);
            assert.equal(args.where.slug, 'tiem-ca-phe-mo-52-13-cao-thang');
            assert.equal(args.where.isPublished, true);
            return {
              id: 'cafe-1',
              name: 'Tiệm cà phê Mơ',
              instagramUrl: 'cafe.brand',
              imageSourceUsernames,
              images: ['photo.webp'],
            };
          },
        },
        cafeVote: { groupBy: async () => [] },
      };
      const service = new CafesService(prisma as any, {} as any);
      const detail: Record<string, unknown> = await service.findBySlug(
        'tiem-ca-phe-mo-52-13-cao-thang',
        locale,
      );
      assert.deepEqual(detail.imageSourceUsernames, imageSourceUsernames);
      assert.equal(detail.instagramUrl, 'cafe.brand');
      assert.deepEqual(detail.images, ['photo.webp']);
    }
  }
});
