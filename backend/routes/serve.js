import { Router } from 'express';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import pool from '../services/db.js';
import { downloadFromR2 } from '../services/r2.js';
import { config } from '../config.js';

const router = Router();

// In-memory cache: key → { buffer, timestamp }
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in-memory
const MAX_CACHE_SIZE = 200;

function evictStale() {
  if (cache.size <= MAX_CACHE_SIZE) return;
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.timestamp > CACHE_TTL || cache.size > MAX_CACHE_SIZE) {
      cache.delete(k);
    }
  }
}

/**
 * Clear all cached variants for photos belonging to a given album.
 * Called when an album's is_published status changes.
 */
export async function clearAlbumServeCache(albumId) {
  try {
    const { rows } = await pool.query('SELECT id FROM photos WHERE album_id = $1', [albumId]);
    for (const row of rows) {
      cache.delete(`${row.id}_thumb`);
      cache.delete(`${row.id}_medium`);
    }
  } catch {
    // non-critical — cache will expire naturally
  }
}

function buildWatermarkSvg(width, height, text, opacity = 0.15) {
  const fontSize = Math.max(16, Math.floor(width / 35));
  const rows = 5;
  const cols = 4;
  const cellW = Math.floor(width / cols);
  const cellH = Math.floor(height / rows);

  const items = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cellW * c + cellW / 2;
      const y = cellH * r + cellH / 2;
      items.push(
        `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"
          font-family="Arial, Helvetica, sans-serif" font-weight="300" font-size="${fontSize}"
          fill="rgba(255,255,255,${opacity})"
          transform="rotate(-30, ${x}, ${y})">${text}</text>`
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${items.join('')}</svg>`;
}

// GET /api/serve/:photoId/:variant (thumb | medium)
router.get('/:photoId/:variant', async (req, res) => {
  const photoId = parseInt(req.params.photoId);
  const variant = req.params.variant;

  if (!['thumb', 'medium'].includes(variant)) {
    return res.status(400).json({ error: 'Invalid variant. Use thumb or medium.' });
  }

  const cacheKey = `${photoId}_${variant}`;

  // Evict stale cache entry upfront
  const existing = cache.get(cacheKey);
  if (existing && Date.now() - existing.timestamp >= CACHE_TTL) {
    cache.delete(cacheKey);
  }

  // Check if admin is requesting (bypass watermark)
  let isAdmin = false;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      jwt.verify(authHeader.slice(7), config.jwtSecret);
      isAdmin = true;
    } catch {
      // invalid token — treat as public
    }
  }

  try {
    const urlCol = variant === 'thumb' ? 'url_thumbnail' : 'url_medium';
    const { rows } = await pool.query(
      `SELECT p.id, p.${urlCol} as url, p.url_original, a.is_published
       FROM photos p JOIN albums a ON p.album_id = a.id
       WHERE p.id = $1`,
      [photoId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Photo not found' });

    const imageUrl = rows[0].url || rows[0].url_original;
    if (!imageUrl) return res.status(404).json({ error: 'Image URL not available' });

    // Extract R2 key
    const publicUrl = config.r2.publicUrl;
    let key = imageUrl;
    if (publicUrl && imageUrl.startsWith(publicUrl)) {
      key = imageUrl.slice(publicUrl.length).replace(/^\//, '');
    }

    const buffer = await downloadFromR2(key);

    // Skip watermark for unpublished albums or admin requests
    if (!rows[0].is_published || isAdmin) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(buffer);
    }

    // Use cached watermarked version if available
    const cached = cache.get(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
      res.setHeader('X-Cache', 'HIT');
      return res.send(cached.buffer);
    }

    // Auto-orient by EXIF before reading metadata (fixes rotated JPEGs)
    const oriented = sharp(buffer).rotate();
    const meta = await oriented.metadata();
    const imgWidth = meta.width || 800;
    const imgHeight = meta.height || 600;

    const watermarkSvg = buildWatermarkSvg(imgWidth, imgHeight, config.watermarkText, 0.13);

    const watermarked = await oriented
      .composite([{ input: Buffer.from(watermarkSvg), gravity: 'center' }])
      .jpeg({ quality: variant === 'thumb' ? 80 : 85 })
      .toBuffer();

    // Store in memory cache
    evictStale();
    cache.set(cacheKey, { buffer: watermarked, timestamp: Date.now() });

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
