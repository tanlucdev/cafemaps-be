import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('registers PayOS only after the configured backend rejects an unsigned webhook', () => {
  const directory = mkdtempSync(join(tmpdir(), 'payos-webhook-test-'));
  const preload = join(directory, 'mock-fetch.cjs');
  try {
    writeFileSync(
      preload,
      `
      const assert = require('node:assert/strict');
      global.fetch = async (input, options) => {
        const url = String(input);
        if (url === 'https://backend.example.test/api/payments/payos/webhook') {
          assert.equal(options.method, 'POST');
          assert.equal(options.body, '{}');
          return Response.json({message: 'INVALID_PAYOS_WEBHOOK'}, {
            status: Number(process.env.PROBE_STATUS),
          });
        }
        assert.equal(process.env.PROBE_STATUS, '400');
        assert.equal(url, 'https://api-merchant.payos.vn/confirm-webhook');
        const {webhookUrl} = JSON.parse(options.body);
        assert.equal(webhookUrl, 'https://backend.example.test/api/payments/payos/webhook');
        return Response.json({code:'00', desc:'success', data:{webhookUrl}});
      };
      `,
    );
    for (const status of [400, 404]) {
      const result = spawnSync(
        process.execPath,
        [
          '--require',
          preload,
          resolve('scripts/register-payos-webhook.cjs'),
          'https://backend.example.test',
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PROBE_STATUS: String(status),
            PAYOS_CLIENT_ID: 'test',
            PAYOS_API_KEY: 'test',
            PAYOS_CHECKSUM_KEY: 'test',
            PAYOS_BASE_URL: 'https://api-merchant.payos.vn',
          },
        },
      );
      assert.equal(result.status, status === 400 ? 0 : 1, result.stderr);
      if (status === 400) assert.match(result.stdout, /PayOS webhook registered/);
      else assert.match(result.stderr, /Webhook is not ready.*HTTP 404/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
