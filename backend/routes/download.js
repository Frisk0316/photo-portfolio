import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import pool from '../services/db.js';
import { downloadFromR2 } from '../services/r2.js';
import { config } from '../config.js';
import { getAdminSession } from '../middleware/auth.js';
import { keyForVariant } from '../utils/r2Keys.js';
import { safeError } from '../utils/safeError.js';

const router = Router();

function escapeSvgText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many download requests. Please try again later.' },
});

// GET /api/download/:photoId
router.get('/:photoId', downloadLimiter, async (req, res) => {
  try {
    const { photoId } = req.params;
    if (!/^\d+$/.test(photoId)) return res.status(404).json({ error: 'Photo not found' });
    const parsedPhotoId = Number(photoId);
    if (!Number.isInteger(parsedPhotoId)) return res.status(404).json({ error: 'Photo not found' });
    const isAdmin = !!getAdminSession(req);

    const { rows } = await pool.query(
      `SELECT p.*, a.is_published
       FROM photos p
       JOIN albums a ON a.id = p.album_id
       WHERE p.id = $1 AND ($2::boolean OR a.is_published = true)`,
      [parsedPhotoId, isAdmin]
    );

    if (!rows.length) return res.status(404).json({ error: 'Photo not found' });

    const photo = rows[0];
    const key = keyForVariant(photo, 'medium') || keyForVariant(photo, 'original');
    if (!key) return res.status(404).json({ error: 'Image URL not available' });

    const buffer = await downloadFromR2(key);

    // Get image dimensions for SVG watermark
    const meta = await sharp(buffer).metadata();
    const imgWidth = meta.width || 1600;
    const imgHeight = meta.height || 1067;
    const watermarkText = escapeSvgText(config.watermarkText);

    // Build a repeating SVG watermark grid
    const fontSize = Math.max(24, Math.floor(imgWidth / 30));
    const rows_count = 5;
    const cols_count = 4;
    const cellW = Math.floor(imgWidth / cols_count);
    const cellH = Math.floor(imgHeight / rows_count);

    const textItems = [];
    for (let r = 0; r < rows_count; r++) {
      for (let c = 0; c < cols_count; c++) {
        const x = cellW * c + cellW / 2;
        const y = cellH * r + cellH / 2;
        textItems.push(
          `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"
            font-family="Arial, sans-serif" font-size="${fontSize}" fill="rgba(255,255,255,0.22)"
            transform="rotate(-30, ${x}, ${y})">${watermarkText}</text>`
        );
      }
    }

    const watermarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">
      ${textItems.join('\n')}
    </svg>`;

    const watermarked = await sharp(buffer)
      .composite([{ input: Buffer.from(watermarkSvg), gravity: 'center' }])
      .jpeg({ quality: 90 })
      .toBuffer();

    const safeFileName = photo.file_name.replace(/[^\w.-]/g, '_');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(watermarked);
  } catch (err) {
    console.error('[download] error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

export default router;
