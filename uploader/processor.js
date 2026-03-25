import sharp from 'sharp';
import { encode } from 'blurhash';
import { config } from './config.js';

export async function processImage(imagePath) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const { width, height } = metadata;
  const aspectRatio = width / height;

  const [original, thumbnail, medium, webpFull, blurHash] = await Promise.all([
    sharp(imagePath).jpeg({ quality: config.jpegQuality, mozjpeg: true }).toBuffer(),
    sharp(imagePath).resize({ height: config.thumbnailHeight, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer(),
    sharp(imagePath).resize({ width: config.mediumWidth, withoutEnlargement: true }).jpeg({ quality: config.jpegQuality, mozjpeg: true }).toBuffer(),
    sharp(imagePath).resize({ width: config.mediumWidth, withoutEnlargement: true }).webp({ quality: config.webpQuality }).toBuffer(),
    generateBlurHash(imagePath),
  ]);

  const thumbMeta = await sharp(thumbnail).metadata();
  const mediumMeta = await sharp(medium).metadata();

  return {
    original: { buffer: original, width, height, format: 'jpeg', size: original.length },
    thumbnail: { buffer: thumbnail, width: thumbMeta.width, height: thumbMeta.height, format: 'jpeg', size: thumbnail.length },
    medium: { buffer: medium, width: mediumMeta.width, height: mediumMeta.height, format: 'jpeg', size: medium.length },
    webp: { buffer: webpFull, format: 'webp', size: webpFull.length },
    meta: {
      originalWidth: width,
      originalHeight: height,
      aspectRatio: Math.round(aspectRatio * 1000) / 1000,
      blurHash,
    },
  };
}

async function generateBlurHash(imagePath) {
  try {
    const { data, info } = await sharp(imagePath).resize(32, 32, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch {
    return null;
  }
}

export function classifyAspectRatio(width, height) {
  const ratio = width / height;
  if (Math.abs(ratio - 4/3) < 0.05) return '4:3';
  if (Math.abs(ratio - 3/2) < 0.05) return '3:2';
  if (Math.abs(ratio - 16/9) < 0.05) return '16:9';
  if (Math.abs(ratio - 21/9) < 0.08) return '21:9';
  if (Math.abs(ratio - 1) < 0.05) return '1:1';
  if (Math.abs(ratio - 3/4) < 0.05) return '3:4';
  if (Math.abs(ratio - 2/3) < 0.05) return '2:3';
  if (Math.abs(ratio - 9/16) < 0.05) return '9:16';
  if (ratio > 2) return 'ultra-wide';
  if (ratio > 1.2) return 'landscape';
  if (ratio < 0.8) return 'portrait';
  return 'square';
}
