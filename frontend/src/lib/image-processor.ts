import { encode } from 'blurhash';

export interface ProcessedImage {
  original: File;
  thumbnail: Blob;
  medium: Blob;
  webp: Blob;
  meta: {
    originalWidth: number;
    originalHeight: number;
    aspectRatio: number;
    blurHash: string | null;
    fileSize: number;
  };
}

const THUMBNAIL_HEIGHT = 400;
const MEDIUM_WIDTH = 1600;
const JPEG_QUALITY = 0.85;
const THUMBNAIL_QUALITY = 0.80;
const WEBP_QUALITY = 0.82;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function resizeToCanvas(
  img: HTMLImageElement,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to create blob'))),
      type,
      quality
    );
  });
}

function generateBlurHash(img: HTMLImageElement): string | null {
  try {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    return encode(imageData.data, size, size, 4, 3);
  } catch {
    return null;
  }
}

export async function processImage(file: File): Promise<ProcessedImage> {
  const img = await loadImage(file);
  const { naturalWidth: w, naturalHeight: h } = img;

  // Calculate dimensions for variants
  const thumbScale = Math.min(1, THUMBNAIL_HEIGHT / h);
  const thumbW = Math.round(w * thumbScale);
  const thumbH = Math.round(h * thumbScale);

  const medScale = Math.min(1, MEDIUM_WIDTH / w);
  const medW = Math.round(w * medScale);
  const medH = Math.round(h * medScale);

  // Generate variants
  const thumbCanvas = resizeToCanvas(img, thumbW, thumbH);
  const medCanvas = resizeToCanvas(img, medW, medH);

  const [thumbnail, medium, webp] = await Promise.all([
    canvasToBlob(thumbCanvas, 'image/jpeg', THUMBNAIL_QUALITY),
    canvasToBlob(medCanvas, 'image/jpeg', JPEG_QUALITY),
    canvasToBlob(medCanvas, 'image/webp', WEBP_QUALITY),
  ]);

  const blurHash = generateBlurHash(img);

  // Clean up object URL
  URL.revokeObjectURL(img.src);

  return {
    original: file,
    thumbnail,
    medium,
    webp,
    meta: {
      originalWidth: w,
      originalHeight: h,
      aspectRatio: Math.round((w / h) * 1000) / 1000,
      blurHash,
      fileSize: file.size,
    },
  };
}

export function classifyAspectRatio(width: number, height: number): string {
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
