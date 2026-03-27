import sharp from 'sharp';
import { encode } from 'blurhash';
import { config } from './config.js';

const WATERMARK_TEXT = 'Ospreay Photo';

function buildWatermarkSvg(imgWidth, imgHeight) {
  const fontSize = Math.max(16, Math.floor(imgWidth / 28));
  const cols = 4;
  const rows = 4;
  const cellW = imgWidth / cols;
  const cellH = imgHeight / rows;

  const items = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.floor(cellW * c + cellW / 2);
      const y = Math.floor(cellH * r + cellH / 2);
      // Dark shadow for visibility on bright backgrounds
      items.push(`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial, sans-serif" font-size="${fontSize}" fill="rgba(0,0,0,0.25)"
        transform="rotate(-30,${x},${y})" dx="1" dy="1">${WATERMARK_TEXT}</text>`);
      // White text on top
      items.push(`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial, sans-serif" font-size="${fontSize}" fill="rgba(255,255,255,0.32)"
        transform="rotate(-30,${x},${y})">${WATERMARK_TEXT}</text>`);
    }
  }

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">${items.join('')}</svg>`
  );
}

async function applyWatermark(pipeline, width, height) {
  const svg = buildWatermarkSvg(width, height);
  return pipeline.composite([{ input: svg, gravity: 'center' }]);
}

export async function processImage(imagePath) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const { width, height } = metadata;
  const aspectRatio = width / height;

  // Compute output dimensions for watermark sizing
  const thumbH = Math.min(config.thumbnailHeight, height);
  const thumbW = Math.round(thumbH * aspectRatio);
  const medW = Math.min(config.mediumWidth, width);
  const medH = Math.round(medW / aspectRatio);

  const [original, thumbnail, medium, webpFull, blurHash] = await Promise.all([
    // Original: no watermark (kept as archival copy, not served directly)
    sharp(imagePath).jpeg({ quality: config.jpegQuality, mozjpeg: true }).toBuffer(),
    // Thumbnail: watermark embedded
    applyWatermark(
      sharp(imagePath).resize({ height: config.thumbnailHeight, withoutEnlargement: true }),
      thumbW, thumbH
    ).then(p => p.jpeg({ quality: 80, mozjpeg: true }).toBuffer()),
    // Medium: watermark embedded
    applyWatermark(
      sharp(imagePath).resize({ width: config.mediumWidth, withoutEnlargement: true }),
      medW, medH
    ).then(p => p.jpeg({ quality: config.jpegQuality, mozjpeg: true }).toBuffer()),
    // WebP medium: watermark embedded
    applyWatermark(
      sharp(imagePath).resize({ width: config.mediumWidth, withoutEnlargement: true }),
      medW, medH
    ).then(p => p.webp({ quality: config.webpQuality }).toBuffer()),
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
