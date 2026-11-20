import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import type {} from 'multer';
import {
  buildQualitySteps,
  getImageStorageProvider,
  isCloudinaryUrl,
  isSupportedSupabaseSecret,
  r2ObjectKeyFromPublicUrl,
  r2PublicUrlForKey,
  readNumberConfig,
  safePublicIdBaseName,
  type ImageStorageProvider,
} from './storage.helpers';
import { convertToBestWebp } from './storage-images';
import { uploadRemoteImage } from './storage-remote';
import {
  deleteCloudinaryImage,
  uploadCloudinaryImage,
  uploadSupabaseImage,
} from './storage-providers';
export {
  cloudinaryOptimizedUrl,
  cloudinaryPublicIdFromUrl,
  getImageStorageProvider,
  isCloudinaryUrl,
  isHeicImage,
  isSupabasePublicStorageUrl,
  r2ObjectKeyFromPublicUrl,
  signCloudinaryParams,
} from './storage.helpers';
type UploadedFile = Express.Multer.File;
const DEFAULT_TARGET_KB = 2048;
const DEFAULT_MAX_QUALITY = 92;
const DEFAULT_MIN_QUALITY = 84;

@Injectable()
export class StorageService {
  private readonly provider: ImageStorageProvider;
  private readonly supabaseUrl: string;
  private readonly supabaseKey: string;
  private readonly bucket: string;
  private readonly cloudinaryCloudName: string;
  private readonly cloudinaryApiKey: string;
  private readonly cloudinaryApiSecret: string;
  private readonly r2Bucket: string;
  private readonly r2PublicUrl: string;
  private readonly r2Client?: S3Client;
  private readonly targetBytes: number;
  private readonly qualitySteps: number[];

  constructor(private config: ConfigService) {
    this.provider = getImageStorageProvider(config.get('IMAGE_STORAGE_PROVIDER'));
    this.supabaseUrl = config.get('SUPABASE_URL', '');
    this.supabaseKey = config.get('SUPABASE_SERVICE_KEY', '');
    this.bucket = config.get('SUPABASE_BUCKET', 'cafe-images');
    this.cloudinaryCloudName = config.get('CLOUDINARY_CLOUD_NAME', '');
    this.cloudinaryApiKey = config.get('CLOUDINARY_API_KEY', '');
    this.cloudinaryApiSecret = config.get('CLOUDINARY_API_SECRET', '');
    this.r2Bucket = config.get('R2_BUCKET', '');
    this.r2PublicUrl = config.get('R2_PUBLIC_URL', '');
    const r2AccountId = config.get('R2_ACCOUNT_ID', '');
    const r2AccessKeyId = config.get('R2_ACCESS_KEY_ID', '');
    const r2SecretAccessKey = config.get('R2_SECRET_ACCESS_KEY', '');
    this.targetBytes =
      readNumberConfig(config.get('IMAGE_MAX_OUTPUT_KB'), DEFAULT_TARGET_KB) * 1024;
    this.qualitySteps = buildQualitySteps(
      readNumberConfig(config.get('IMAGE_WEBP_MAX_QUALITY'), DEFAULT_MAX_QUALITY),
      readNumberConfig(config.get('IMAGE_WEBP_MIN_QUALITY'), DEFAULT_MIN_QUALITY),
    );

    if (
      this.provider === 'cloudinary' &&
      (!this.cloudinaryCloudName || !this.cloudinaryApiKey || !this.cloudinaryApiSecret)
    ) {
      throw new Error(
        'Cloudinary requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET',
      );
    }

    if (
      this.provider === 'supabase' &&
      this.supabaseKey &&
      !isSupportedSupabaseSecret(this.supabaseKey)
    ) {
      throw new Error(
        'SUPABASE_SERVICE_KEY must be a Supabase secret key. ' +
          'Use a new sb_secret_ key or a legacy service_role JWT from Supabase Project Settings → API Keys.',
      );
    }

    if (this.provider === 'r2') {
      if (
        !r2AccountId ||
        !r2AccessKeyId ||
        !r2SecretAccessKey ||
        !this.r2Bucket ||
        !this.r2PublicUrl
      ) {
        throw new Error(
          'R2 requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_PUBLIC_URL',
        );
      }
      try {
        const publicUrl = new URL(this.r2PublicUrl);
        if (
          !['http:', 'https:'].includes(publicUrl.protocol) ||
          publicUrl.username ||
          publicUrl.password ||
          publicUrl.search ||
          publicUrl.hash
        )
          throw new Error();
      } catch {
        throw new Error(
          'R2_PUBLIC_URL must be an absolute http(s) URL without credentials or query',
        );
      }
      this.r2Client = new S3Client({
        region: 'auto',
        endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey },
      });
    }
  }

  private convertToBestWebp(file: UploadedFile) {
    return convertToBestWebp(file, this.qualitySteps, this.targetBytes);
  }

  uploadImageFromUrl(imageUrl: string, folder = 'cafes') {
    return uploadRemoteImage(imageUrl, folder, (file, path) => this.uploadImage(file, path));
  }

  uploadImage(file: UploadedFile, folder = 'cafes'): Promise<string> {
    const convert = () => this.convertToBestWebp(file);
    if (this.provider === 'cloudinary')
      return uploadCloudinaryImage(
        file,
        folder,
        {
          cloudinaryCloudName: this.cloudinaryCloudName,
          cloudinaryApiKey: this.cloudinaryApiKey,
          cloudinaryApiSecret: this.cloudinaryApiSecret,
        },
        convert,
      );
    if (this.provider === 'r2') return this.uploadImageToR2(file, folder);
    return uploadSupabaseImage(
      file,
      folder,
      {
        supabaseUrl: this.supabaseUrl,
        supabaseKey: this.supabaseKey,
        bucket: this.bucket,
      },
      convert,
    );
  }

  private async uploadImageToR2(file: UploadedFile, folder: string): Promise<string> {
    if (!this.r2Client || !this.r2Bucket || !this.r2PublicUrl)
      throw new InternalServerErrorException('R2 is not configured');

    let webpBuffer: Buffer;
    try {
      webpBuffer = await this.convertToBestWebp(file);
    } catch (error) {
      throw new InternalServerErrorException(
        `Image conversion failed: ${(error as Error).message}`,
      );
    }

    const key = `${folder.replace(/^\/+|\/+$/g, '')}/${Date.now()}-${randomUUID()}-${safePublicIdBaseName(file.originalname)}.webp`;
    try {
      await this.r2Client.send(
        new PutObjectCommand({
          Bucket: this.r2Bucket,
          Key: key,
          Body: webpBuffer,
          ContentType: 'image/webp',
        }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          type: 'r2.upload.failed',
          bucket: this.r2Bucket,
          key,
          name: error?.name,
          status: error?.$metadata?.httpStatusCode,
        }),
      );
      // The PUT may have committed before its response was lost; compensate with its known key.
      try {
        await this.r2Client.send(new DeleteObjectCommand({ Bucket: this.r2Bucket, Key: key }), {
          abortSignal: AbortSignal.timeout(30_000),
        });
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            type: 'r2.upload.cleanup.failed',
            bucket: this.r2Bucket,
            key,
            name: cleanupError?.name,
            status: cleanupError?.$metadata?.httpStatusCode,
          }),
        );
      }
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError')
        throw new GatewayTimeoutException('Image storage upload timed out');
      throw new BadGatewayException('Image storage upload failed');
    }
    return r2PublicUrlForKey(this.r2PublicUrl, key);
  }

  async deleteImage(imageUrl: string): Promise<void> {
    if (isCloudinaryUrl(imageUrl))
      return deleteCloudinaryImage(imageUrl, {
        cloudinaryCloudName: this.cloudinaryCloudName,
        cloudinaryApiKey: this.cloudinaryApiKey,
        cloudinaryApiSecret: this.cloudinaryApiSecret,
      });
    if (this.r2Client && this.r2Bucket && this.r2PublicUrl) {
      const key = r2ObjectKeyFromPublicUrl(imageUrl, this.r2PublicUrl);
      if (!key) return;
      try {
        await this.r2Client.send(new DeleteObjectCommand({ Bucket: this.r2Bucket, Key: key }), {
          abortSignal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new BadGatewayException('Image storage is unavailable');
      }
      return;
    }
    if (this.provider !== 'supabase') return;
    if (!this.supabaseUrl || !this.supabaseKey) return;

    const publicPrefix = `${this.supabaseUrl}/storage/v1/object/public/${this.bucket}/`;
    if (!imageUrl.startsWith(publicPrefix)) return;

    const path = imageUrl.slice(publicPrefix.length);

    await fetch(`${this.supabaseUrl}/storage/v1/object/${this.bucket}/${path}`, {
      method: 'DELETE',
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
      },
    });
  }
}
