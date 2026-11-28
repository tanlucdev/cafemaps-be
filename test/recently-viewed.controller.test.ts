import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CafesController } from '../src/cafes/cafes.controller';

test('public cafe views persist history only for an authenticated user', async () => {
  const tracked: string[] = [];
  const persisted: string[] = [];
  const controller = new CafesController(
    {} as any,
    {
      trackView: async (_cafeId: string, visitor: string) => {
        const counted = tracked.length === 0;
        tracked.push(visitor);
        return { viewCount: 1, counted };
      },
    } as any,
    {} as any,
    { verifyAsync: async () => ({ sub: 'user-1' }) } as any,
    { recordView: async (userId: string, cafeId: string) => persisted.push(`${userId}:${cafeId}`) } as any,
  );
  const response = { cookie: () => undefined } as any;

  await controller.trackView('cafe-1', { headers: {} } as any, response);
  assert.deepEqual(persisted, []);
  assert.match(tracked[0], /^anon:/);

  const result = await controller.trackView(
    'cafe-1',
    { headers: { authorization: 'Bearer valid-token' } } as any,
    response,
    { id: 'user-1' },
  );
  assert.deepEqual(result, { viewCount: 1, counted: false });
  assert.deepEqual(persisted, ['user-1:cafe-1']);
  assert.deepEqual(tracked, [tracked[0], 'user:user-1']);
});
