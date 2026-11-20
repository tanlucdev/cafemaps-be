import { createHash } from 'crypto';
import { basename, extname } from 'path';
import type {} from 'multer';
type UploadedFile = Express.Multer.File;

export type ImageStorageProvider = 'supabase' | 'cloudinary' | 'r2';

export function getImageStorageProvider(value?: string): ImageStorageProvider {
  if (value === 'cloudinary' || value === 'r2') return value;
  return 'supabase';
}

export function signCloudinaryParams(params: Record<string, string>, apiSecret: string) {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

export function isCloudinaryUrl(imageUrl: string) {
  try {
    return new URL(imageUrl).hostname === 'res.cloudinary.com';
  } catch {
    return false;
  }
}

export function cloudinaryPublicIdFromUrl(imageUrl: string, cloudName?: string): string | null {
  try {
    const url = new URL(imageUrl);
    if (url.hostname !== 'res.cloudinary.com') return null;
    if (cloudName && url.pathname.split('/')[1] !== cloudName) return null;

    const marker = '/image/upload/';
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return null;

    const parts = url.pathname
      .slice(markerIndex + marker.length)
      .split('/')
      .filter(Boolean);
    const versionIndex = parts.findIndex((part) => /^v\d+$/.test(part));
    const publicPath = (versionIndex === -1 ? parts : parts.slice(versionIndex + 1)).join('/');
    return publicPath.replace(/\.[^/.]+$/, '') || null;
  } catch {
    return null;
  }
}

export function cloudinaryOptimizedUrl(imageUrl: string) {
  try {
    const url = new URL(imageUrl);
    const marker = '/image/upload/';
    const markerIndex = url.pathname.indexOf(marker);
    if (url.hostname !== 'res.cloudinary.com' || markerIndex === -1) return imageUrl;

    const afterUpload = url.pathname.slice(markerIndex + marker.length);
    if (afterUpload.startsWith('f_auto,q_auto/')) return imageUrl;

    url.pathname = `${url.pathname.slice(0, markerIndex + marker.length)}f_auto,q_auto/${afterUpload}`;
    return url.toString();
  } catch {
    return imageUrl;
  }
}

export function isSupabasePublicStorageUrl(imageUrl: string, supabaseUrl = '') {
  try {
    const url = new URL(imageUrl);
    const configuredHost = supabaseUrl ? new URL(supabaseUrl).hostname : '';
    return (
      url.pathname.startsWith('/storage/v1/object/public/') &&
      (url.hostname.endsWith('.supabase.co') || url.hostname === configuredHost)
    );
  } catch {
    return false;
  }
}

export function r2PublicUrlForKey(publicUrl: string, key: string) {
  const base = new URL(`${publicUrl.replace(/\/$/, '')}/`);
  return new URL(key.split('/').map(encodeURIComponent).join('/'), base).toString();
}

export function r2ObjectKeyFromPublicUrl(imageUrl: string, publicUrl: string): string | null {
  try {
    const url = new URL(imageUrl);
    const base = new URL(`${publicUrl.replace(/\/$/, '')}/`);
    if (
      url.search ||
      url.hash ||
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname)
    )
      return null;
    const key = url.pathname
      .slice(base.pathname.length)
      .split('/')
      .map(decodeURIComponent)
      .join('/');
    if (!key || key.split('/').some((part) => !part || part === '.' || part === '..')) return null;
    return r2PublicUrlForKey(publicUrl, key) === url.toString() ? key : null;
  } catch {
    return null;
  }
}

export function readNumberConfig(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function clampQuality(value: number) {
  return Math.min(100, Math.max(1, Math.round(value)));
}

export function buildQualitySteps(maxQuality: number, minQuality: number) {
  const max = clampQuality(maxQuality);
  const min = Math.min(max, clampQuality(minQuality));
  const steps: number[] = [];

  for (let quality = max; quality >= min; quality -= 2) steps.push(quality);

  if (steps.at(-1) !== min) steps.push(min);
  return steps;
}

export function isSupportedSupabaseSecret(key: string) {
  return key.startsWith('eyJ') || key.startsWith('sb_secret_');
}

export function isHeicImage(file: UploadedFile) {
  const extension = extname(file.originalname).toLowerCase();
  return (
    ['.heic', '.heif', '.heics', '.heifs'].includes(extension) ||
    /image\/hei[cf]/i.test(file.mimetype)
  );
}

export function isPrivateIp(address: string) {
  if (address === '127.0.0.1' || address === '0.0.0.0' || address === '::1') return true;
  if (address.startsWith('10.') || address.startsWith('192.168.')) return true;

  const parts = address.split('.').map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part))) {
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
  }

  const lower = address.toLowerCase();
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
}

export function extensionFromUrl(url: URL) {
  const extension = extname(url.pathname).toLowerCase();
  return extension || '.jpg';
}

export function basenameFromUrl(url: URL) {
  const name = basename(decodeURIComponent(url.pathname));
  return name || `remote-image${extensionFromUrl(url)}`;
}

export function safePublicIdBaseName(name: string) {
  return basename(name, extname(name)).replace(/[^a-zA-Z0-9_.-]+/g, '_') || 'image';
}
