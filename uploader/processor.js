import fs from 'fs/promises';
import sharp from 'sharp';
import { encode } from 'blurhash';
import { config } from './config.js';

// Disable libvips cache and limit internal threads to prevent memory accumulation
// over large batch uploads.
sharp.cache(false);
sharp.concurrency(1);
sharp.simd(false);

export async function processImage(imagePath) {
  // Read the file once into a Buffer. Passing a Buffer to sharp avoids
  // libvips re-opening and re-decoding the JPEG for every variant — which
  // was triggering native crashes on Windows for large batches.
  const fileBuffer = await fs.readFile(imagePath);

  const metadata = await sharp(fileBuffer).metadata();
  const { width, height } = metadata;
  const aspectRatio = width / height;

  const original = await sharp(fileBuffer).jpeg({ quality: config.jpegQuality, mozjpeg: true }).toBuffer();
  const thumbnail = await sharp(fileBuffer).resize({ height: config.thumbnailHeight, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  const medium = await sharp(fileBuffer).resize({ width: config.mediumWidth, withoutEnlargement: true }).jpeg({ quality: config.jpegQuality, mozjpeg: true }).toBuffer();
  const webpFull = await sharp(fileBuffer).resize({ width: config.mediumWidth, withoutEnlargement: true }).webp({ quality: config.webpQuality }).toBuffer();
  const blurHash = await generateBlurHash(fileBuffer);

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

async function generateBlurHash(source) {
  try {
    const { data, info } = await sharp(source).resize(32, 32, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
