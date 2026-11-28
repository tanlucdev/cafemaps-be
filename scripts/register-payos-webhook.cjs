const { PayOS } = require('@payos/node');

async function registerWebhook() {
  const input = process.argv[2] ?? '';
  const backend = URL.canParse(input) ? new URL(input) : null;
  if (
    backend?.protocol !== 'https:' ||
    backend.username ||
    backend.password ||
    backend.pathname !== '/' ||
    backend.search ||
    backend.hash
  ) {
    throw new Error('Usage: npm run payos:register-webhook -- https://<backend-host>');
  }

  const webhookUrl = new URL('/api/payments/payos/webhook', backend).href;
  const probe = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  const result = await probe.json().catch(() => null);
  if (probe.status !== 400 || result?.message !== 'INVALID_PAYOS_WEBHOOK') {
    throw new Error(
      `Webhook is not ready at ${webhookUrl} (HTTP ${probe.status}). Deploy the backend with PayOS credentials first.`,
    );
  }

  for (const key of ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY']) {
    if (!process.env[key]?.trim()) throw new Error(`Missing ${key}`);
  }

  try {
    const payos = new PayOS({ timeout: 10000, maxRetries: 0 });
    const confirmed = await payos.webhooks.confirm(webhookUrl);
    if (confirmed?.webhookUrl !== webhookUrl) {
      throw new Error('PayOS did not return the requested URL.');
    }
  } catch {
    throw new Error(
      'PayOS registration could not be confirmed. Check the channel webhook URL before retrying.',
    );
  }

  console.log(`PayOS webhook registered: ${webhookUrl}`);
}

registerWebhook().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
