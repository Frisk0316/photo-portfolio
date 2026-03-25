import sharp from 'sharp';
import { encode } from 'blurhash';
import { config } from '../config.js';

export async function processImageBuffer(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  let exifData = null;
  try {
    const exif = metadata.exif;
    if (exif) {
      // Extract basic EXIF info via sharp
      exifData = {
        make: metadata.make,
        model: metadata.model,
        width,
        height,
      };
    }
  } catch {
    exifData = null;
  }

  const [original, thumbnail, medium, webpBuf, blurHash] = await Promise.all([
    sharp(buffer).jpeg({ quality: config.jpegQuality, mozjpeg: true }).toBuffer(),
    sharp(buffer).resize({ height: config.thumbnailHeight, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer(),
    sharp(buffer).resize({ width: config.mediumWidth, withoutEnlargement: true }).jpeg({ quality: config.jpegQuality, mozjpeg: true }).toBuffer(),
    sharp(buffer).resize({ width: config.mediumWidth, withoutEnlargement: true }).webp({ quality: config.webpQuality }).toBuffer(),
    generateBlurHash(buffer),
  ]);

  const thumbMeta = await sharp(thumbnail).metadata();
  const mediumMeta = await sharp(medium).metadata();

  return {
    original: { buffer: original, width, height, format: 'jpeg' },
    thumbnail: { buffer: thumbnail, width: thumbMeta.width, height: thumbMeta.height, format: 'jpeg' },
    medium: { buffer: medium, width: mediumMeta.width, height: mediumMeta.height, format: 'jpeg' },
    webp: { buffer: webpBuf, format: 'webp' },
    meta: {
      originalWidth: width,
      originalHeight: height,
      aspectRatio: Math.round((width / height) * 1000) / 1000,
      blurHash,
      exifData,
    },
  };
}

async function generateBlurHash(buffer) {
  try {
    const { data, info } = await sharp(buffer)
      .resize(32, 32, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch {
    return null;
  }
}

export function classifyAspectRatio(width, height) {
  const ratio = width / height;
  if (Math.abs(ratio - 4 / 3) < 0.05) return '4:3';
  if (Math.abs(ratio - 3 / 2) < 0.05) return '3:2';
  if (Math.abs(ratio - 16 / 9) < 0.05) return '16:9';
  if (Math.abs(ratio - 21 / 9) < 0.08) return '21:9';
  if (Math.abs(ratio - 1) < 0.05) return '1:1';
  if (Math.abs(ratio - 3 / 4) < 0.05) return '3:4';
  if (Math.abs(ratio - 2 / 3) < 0.05) return '2:3';
  if (Math.abs(ratio - 9 / 16) < 0.05) return '9:16';
  if (ratio > 2) return 'ultra-wide';
  if (ratio > 1.2) return 'landscape';
  if (ratio < 0.8) return 'portrait';
  return 'square';
}
