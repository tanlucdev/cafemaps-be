import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import sharp = require('sharp');
import { promisify } from 'util';
import { isHeicImage } from './storage.helpers';
import type {} from 'multer';
type UploadedFile = Express.Multer.File;
const WEBP_OPTIONS = { effort: 6, smartSubsample: true };
const HEIF_CONVERT_COMMAND = 'heif-convert';
const SIPS_PATH = '/usr/bin/sips';
const run = promisify(execFile);

async function createHeicPngFallback(file: UploadedFile): Promise<{
  buffer: Buffer;
  cleanup: () => Promise<void>;
}> {
  const extension = extname(file.originalname).toLowerCase() || '.heic';
  const tempBase = join(
    tmpdir(),
    `cafe-image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const inputPath = `${tempBase}${extension}`;
  const outputPath = `${tempBase}.png`;
  const fallbackErrors: string[] = [];

  await fsp.writeFile(inputPath, file.buffer);

  const cleanup = async () => {
    await Promise.all([fsp.rm(inputPath, { force: true }), fsp.rm(outputPath, { force: true })]);
  };

  try {
    await run(HEIF_CONVERT_COMMAND, [inputPath, outputPath]);
    return { buffer: await fsp.readFile(outputPath), cleanup };
  } catch (error) {
    fallbackErrors.push(`heif-convert fallback failed: ${(error as Error).message}`);
    await fsp.rm(outputPath, { force: true });
  }

  try {
    await run(SIPS_PATH, ['-s', 'format', 'png', inputPath, '--out', outputPath]);
    return { buffer: await fsp.readFile(outputPath), cleanup };
  } catch (error) {
    fallbackErrors.push(`sips fallback failed: ${(error as Error).message}`);
    await cleanup();
  }

  throw new Error(fallbackErrors.join('; '));
}

async function getSharpInput(
  file: UploadedFile,
  qualitySteps: number[],
): Promise<{
  buffer: Buffer;
  cleanup?: () => Promise<void>;
}> {
  if (!isHeicImage(file)) return { buffer: file.buffer };

  try {
    await sharp(file.buffer)
      .rotate()
      .webp({ ...WEBP_OPTIONS, quality: qualitySteps[0] })
      .toBuffer();
    return { buffer: file.buffer };
  } catch {
    return createHeicPngFallback(file);
  }
}

export async function convertToBestWebp(
  file: UploadedFile,
  qualitySteps: number[],
  targetBytes: number,
): Promise<Buffer> {
  const { buffer, cleanup } = await getSharpInput(file, qualitySteps);
  const candidates: Buffer[] = [];

  try {
    for (const quality of qualitySteps) {
      const candidate = await sharp(buffer)
        .rotate()
        .webp({ ...WEBP_OPTIONS, quality })
        .toBuffer();

      candidates.push(candidate);
      if (candidate.byteLength <= targetBytes) break;
    }

    return candidates.find((candidate) => candidate.byteLength <= targetBytes) ?? candidates.at(-1);
  } finally {
    await cleanup?.();
  }
}
