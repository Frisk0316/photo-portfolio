import { Router } from 'express';
import pool from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { safeError } from '../utils/safeError.js';

const router = Router();

// GET /api/upload/worker-url — return the Cloudflare Worker URL for R2 uploads
router.get('/worker-url', requireAuth, (req, res) => {
  const workerUrl = config.r2.workerUrl;
  if (!workerUrl) {
    return res.status(500).json({ error: 'Upload worker URL not configured' });
  }
  res.json({ data: { workerUrl } });
});

// POST /api/upload/register — register a photo in the database (no image processing)
router.post('/register', requireAuth, async (req, res) => {
  try {
    const {
      albumId, fileName, width, height, aspectRatio, aspectCategory,
      blurHash, urlOriginal, urlThumbnail, urlSmall, urlMedium, urlWebp,
      fileSize, sortOrder = 0,
    } = req.body;

    if (!albumId || !fileName || !width || !height || !urlOriginal) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO photos (album_id, file_name, aspect_ratio, aspect_category, width, height,
        blur_hash, url_original, url_thumbnail, url_small, url_medium, url_webp, file_size, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT DO NOTHING RETURNING *`,
      [albumId, fileName, aspectRatio, aspectCategory, width, height,
       blurHash, urlOriginal, urlThumbnail, urlSmall, urlMedium, urlWebp,
       fileSize, sortOrder]
    );

    if (!result.rows[0]) {
      return res.status(409).json({ error: 'Photo already exists' });
    }

    // Update album stats
    await pool.query(`
      UPDATE albums SET
        photo_count = (SELECT COUNT(*) FROM photos WHERE album_id = $1),
        cover_photo_id = COALESCE(cover_photo_id, (SELECT id FROM photos WHERE album_id = $1 ORDER BY sort_order LIMIT 1)),
        updated_at = NOW()
      WHERE id = $1
    `, [albumId]);

    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: safeError(err) });
  }
});

export default router;
