import {
  BadGatewayException,
  GatewayTimeoutException,
  InternalServerErrorException,
} from '@nestjs/common';
import { basename, extname } from 'path';
import {
  cloudinaryPublicIdFromUrl,
  safePublicIdBaseName,
  signCloudinaryParams,
} from './storage.helpers';
import type {} from 'multer';
type UploadedFile = Express.Multer.File;
type CloudinaryConfig = {
  cloudinaryCloudName: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
};
const CLOUDINARY_UPLOAD_TIMEOUT_MS = 30_000;

export async function uploadSupabaseImage(
  file: UploadedFile,
  folder: string,
  config: { supabaseUrl: string; supabaseKey: string; bucket: string },
  convert: () => Promise<Buffer>,
): Promise<string> {
  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new InternalServerErrorException('Supabase is not configured');
  }

  let webpBuffer: Buffer;
  try {
    webpBuffer = await convert();
  } catch (error) {
    throw new InternalServerErrorException(`Image conversion failed: ${(error as Error).message}`);
  }

  const baseName = basename(file.originalname, extname(file.originalname)).replace(/\s/g, '_');
  const fileName = `${folder}/${Date.now()}-${baseName}.webp`;

  const response = await fetch(
    `${config.supabaseUrl}/storage/v1/object/${config.bucket}/${fileName}`,
    {
      method: 'POST',
      headers: {
        apikey: config.supabaseKey,
        Authorization: `Bearer ${config.supabaseKey}`,
        'Content-Type': 'image/webp',
      },
      body: webpBuffer as any,
    },
  );

  if (!response.ok) {
    const raw = await response.text();
    let parsed: { statusCode?: string; error?: string; message?: string } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* not JSON */
    }

    if (
      response.status === 401 ||
      response.status === 403 ||
      parsed.message?.includes('JWS') ||
      parsed.message?.includes('JWT')
    ) {
      throw new InternalServerErrorException(
        'Supabase Storage auth failed (check SUPABASE_SERVICE_KEY and SUPABASE_URL in .env). ' +
          `Supabase said: ${parsed.message ?? raw}`,
      );
    }

    throw new InternalServerErrorException(`Image upload failed: ${parsed.message ?? raw}`);
  }

  return `${config.supabaseUrl}/storage/v1/object/public/${config.bucket}/${fileName}`;
}

export async function uploadCloudinaryImage(
  file: UploadedFile,
  folder: string,
  config: CloudinaryConfig,
  convert: () => Promise<Buffer>,
): Promise<string> {
  if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
    throw new InternalServerErrorException('Cloudinary is not configured');
  }

  const startedAt = Date.now();
  let uploadBuffer = file.buffer;
  let contentType = file.mimetype || 'application/octet-stream';
  let extension = extname(file.originalname).toLowerCase() || '.jpg';

  const convertStartedAt = Date.now();
  try {
    uploadBuffer = await convert();
    contentType = 'image/webp';
    extension = '.webp';
  } catch (error) {
    throw new InternalServerErrorException(`Image conversion failed: ${(error as Error).message}`);
  } finally {
    console.log(`cloudinary_upload_phase=convert ms=${Date.now() - convertStartedAt}`);
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const publicId = `${timestamp}-${safePublicIdBaseName(file.originalname)}`;
  const signedParams = { folder, public_id: publicId, timestamp };
  const body = new FormData();
  body.set(
    'file',
    new Blob([uploadBuffer as any], { type: contentType }),
    `${publicId}${extension}`,
  );
  body.set('api_key', config.cloudinaryApiKey);
  body.set('folder', folder);
  body.set('public_id', publicId);
  body.set('timestamp', timestamp);
  body.set('signature', signCloudinaryParams(signedParams, config.cloudinaryApiSecret));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUDINARY_UPLOAD_TIMEOUT_MS);
  let response: Response;
  let raw: string;
  const uploadStartedAt = Date.now();
  try {
    response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudinaryCloudName)}/image/upload`,
      { method: 'POST', body, signal: controller.signal },
    );
    raw = await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GatewayTimeoutException('Image storage upload timed out');
    }
    throw new BadGatewayException('Image storage is unavailable');
  } finally {
    clearTimeout(timeout);
    console.log(`cloudinary_upload_phase=upload ms=${Date.now() - uploadStartedAt}`);
    console.log(
      `cloudinary_upload_phase=total mode=optimized bytes=${uploadBuffer.byteLength} ms=${Date.now() - startedAt}`,
    );
  }

  let parsed: { secure_url?: string; error?: { message?: string } } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* not JSON */
  }

  if (!response.ok || !parsed.secure_url) {
    console.error(
      JSON.stringify({
        type: 'cloudinary.upload.failed',
        status: response.status,
        message: parsed.error?.message ?? raw.slice(0, 500),
      }),
    );
    throw new BadGatewayException('Image storage upload failed');
  }

  return parsed.secure_url;
}

export async function deleteCloudinaryImage(
  imageUrl: string,
  config: CloudinaryConfig,
): Promise<void> {
  if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret)
    throw new InternalServerErrorException('Cloudinary is not configured for deletion');
  const publicId = cloudinaryPublicIdFromUrl(imageUrl, config.cloudinaryCloudName);
  if (!publicId)
    throw new BadGatewayException('Image URL is outside configured Cloudinary storage');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = new FormData();
  body.set('api_key', config.cloudinaryApiKey);
  body.set('public_id', publicId);
  body.set('timestamp', timestamp);
  body.set(
    'signature',
    signCloudinaryParams({ public_id: publicId, timestamp }, config.cloudinaryApiSecret),
  );
  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${config.cloudinaryCloudName}/image/destroy`,
      {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(CLOUDINARY_UPLOAD_TIMEOUT_MS),
      },
    );
    const result = (await response.json()) as { result?: string };
    if (!response.ok || !['ok', 'not found'].includes(result.result ?? ''))
      throw new BadGatewayException('Image storage deletion failed');
  } catch (error) {
    if (error instanceof BadGatewayException) throw error;
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError')
      throw new GatewayTimeoutException('Image storage deletion timed out');
    throw new BadGatewayException('Image storage is unavailable');
  }
}
