import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import pool from '../services/db.js';
import { downloadFromR2 } from '../services/r2.js';
import { config } from '../config.js';

const router = Router();

const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many download requests. Please try again later.' },
});

// GET /api/download/:photoId
router.get('/:photoId', downloadLimiter, async (req, res) => {
  const { photoId } = req.params;

  const { rows } = await pool.query(
    `SELECT id, file_name, url_medium, url_original, width, height FROM photos WHERE id = $1`,
    [parseInt(photoId)]
  );

  if (!rows.length) return res.status(404).json({ error: 'Photo not found' });

  const photo = rows[0];
  const imageUrl = photo.url_medium || photo.url_original;
  if (!imageUrl) return res.status(404).json({ error: 'Image URL not available' });

  // Extract R2 key from URL
  const publicUrl = config.r2.publicUrl;
  let key = imageUrl;
  if (publicUrl && imageUrl.startsWith(publicUrl)) {
    key = imageUrl.slice(publicUrl.length).replace(/^\//, '');
  }

  const buffer = await downloadFromR2(key);

  // Get image dimensions for SVG watermark
  const meta = await sharp(buffer).metadata();
  const imgWidth = meta.width || 1600;
  const imgHeight = meta.height || 1067;
  const watermarkText = config.watermarkText;

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
});

export default router;
