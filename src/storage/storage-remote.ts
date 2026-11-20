import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { basenameFromUrl, isPrivateIp } from './storage.helpers';
import type {} from 'multer';
type UploadedFile = Express.Multer.File;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const REMOTE_IMAGE_TIMEOUT_MS = 15_000;

async function assertSafeRemoteUrl(imageUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https image URLs are supported');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Image URL must not contain credentials');
  }

  const addresses = isIP(parsed.hostname)
    ? [{ address: parsed.hostname }]
    : await lookup(parsed.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Private or local image URLs are not allowed');
  }

  return parsed;
}

export async function uploadRemoteImage(
  imageUrl: string,
  folder: string,
  upload: (file: UploadedFile, folder: string) => Promise<string>,
): Promise<string> {
  const parsedUrl = await assertSafeRemoteUrl(imageUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_IMAGE_TIMEOUT_MS);

  try {
    const response = await fetch(parsedUrl, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error('Source image redirects are not supported');
    }
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!contentType.startsWith('image/')) throw new Error('Source is not an image');

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_SOURCE_BYTES) throw new Error('Source image is larger than 25MB');

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error('Source image is larger than 25MB');

    return upload(
      {
        originalname: basenameFromUrl(parsedUrl),
        mimetype: contentType,
        buffer,
      } as UploadedFile,
      folder,
    );
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Source image request timed out'
        : (error as Error).message;
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}
