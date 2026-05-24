import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import pool from '../services/db.js';
import { downloadFromR2 } from '../services/r2.js';
import { config } from '../config.js';
import { getAdminSession } from '../middleware/auth.js';
import { keyForVariant } from '../utils/r2Keys.js';

const router = Router();

const serveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(serveLimiter);

// In-memory cache: key -> { buffer, timestamp }
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000;
const MAX_CACHE_SIZE = 200;
const MAX_CACHE_BYTES = 75 * 1024 * 1024;
let cacheBytes = 0;

function deleteCacheEntry(key) {
  const entry = cache.get(key);
  if (!entry) return;
  cacheBytes -= entry.buffer.length;
  cache.delete(key);
}

function evictStale() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.timestamp > CACHE_TTL) deleteCacheEntry(k);
  }
  while (cache.size > MAX_CACHE_SIZE || cacheBytes > MAX_CACHE_BYTES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    deleteCacheEntry(oldestKey);
  }
}

export async function clearAlbumServeCache(albumId) {
  try {
    const { rows } = await pool.query('SELECT id FROM photos WHERE album_id = $1', [albumId]);
    for (const row of rows) {
      deleteCacheEntry(`${row.id}_thumb`);
      deleteCacheEntry(`${row.id}_medium`);
    }
  } catch {
    // Cache will expire naturally.
  }
}

function escapeSvgText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildWatermarkSvg(width, height, text, opacity = 0.15) {
  const fontSize = Math.max(16, Math.floor(width / 35));
  const rows = 5;
  const cols = 4;
  const cellW = Math.floor(width / cols);
  const cellH = Math.floor(height / rows);
  const safeText = escapeSvgText(text);

  const items = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cellW * c + cellW / 2;
      const y = cellH * r + cellH / 2;
      items.push(
        `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"
          font-family="Arial, Helvetica, sans-serif" font-weight="300" font-size="${fontSize}"
          fill="rgba(255,255,255,${opacity})"
          transform="rotate(-30, ${x}, ${y})">${safeText}</text>`
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${items.join('')}</svg>`;
}

router.get('/:photoId/:variant', async (req, res) => {
  if (!/^\d+$/.test(req.params.photoId)) {
    return res.status(400).json({ error: 'Invalid photo id.' });
  }
  const photoId = Number(req.params.photoId);
  const variant = req.params.variant;

  if (!Number.isInteger(photoId) || photoId <= 0) {
    return res.status(400).json({ error: 'Invalid photo id.' });
  }
  if (!['thumb', 'medium'].includes(variant)) {
    return res.status(400).json({ error: 'Invalid variant. Use thumb or medium.' });
  }

  const adminSession = getAdminSession(req);
  const isAdmin = req.query.admin === '1' && !!adminSession;
  const cacheKey = `${photoId}_${variant}`;

  const existing = cache.get(cacheKey);
  if (existing && Date.now() - existing.timestamp >= CACHE_TTL) {
    deleteCacheEntry(cacheKey);
  }

  try {
    const { rows } = await pool.query(
      `SELECT p.*, a.is_published
       FROM photos p
       JOIN albums a ON p.album_id = a.id
       WHERE p.id = $1 AND ($2::boolean OR a.is_published = true)`,
      [photoId, isAdmin]
    );

    if (!rows.length) return res.status(404).json({ error: 'Photo not found' });

    const photo = rows[0];
    const key = variant === 'thumb'
      ? keyForVariant(photo, 'thumbnail') || keyForVariant(photo, 'small') || keyForVariant(photo, 'medium')
      : keyForVariant(photo, 'medium') || keyForVariant(photo, 'original');
    if (!key) return res.status(404).json({ error: 'Image URL not available' });

    const cached = cache.get(cacheKey);
    if (!isAdmin && cached) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
      res.setHeader('X-Cache', 'HIT');
      return res.send(cached.buffer);
    }

    const buffer = await downloadFromR2(key);

    if (isAdmin) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Vary', 'Cookie');
      return res.send(buffer);
    }

    const oriented = sharp(buffer).rotate();
    const meta = await oriented.metadata();
    const imgWidth = meta.width || 800;
    const imgHeight = meta.height || 600;

    const watermarkSvg = buildWatermarkSvg(imgWidth, imgHeight, config.watermarkText, 0.13);

    const watermarked = await oriented
      .composite([{ input: Buffer.from(watermarkSvg), gravity: 'center' }])
      .jpeg({ quality: variant === 'thumb' ? 80 : 85 })
      .toBuffer();

    evictStale();
    deleteCacheEntry(cacheKey);
    cache.set(cacheKey, { buffer: watermarked, timestamp: Date.now() });
    cacheBytes += watermarked.length;
    evictStale();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    res.setHeader('X-Cache', 'MISS');
    res.send(watermarked);
  } catch (err) {
    console.error('Serve watermark error:', err.message);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

export default router;
