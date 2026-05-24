import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../services/db.js';
import { requireAuth, requireAdminMutation } from '../middleware/auth.js';
import { config } from '../config.js';
import { buildPublicUrl } from '../services/r2.js';
import { safeError } from '../utils/safeError.js';
import { sanitizePhoto } from '../utils/photoDto.js';
import { isSafeUploadKeyForPrefix } from '../utils/r2Keys.js';

const router = Router();

function uploadTokenSecret() {
  if (!config.r2.workerSecret) {
    throw new Error('R2_WORKER_SECRET is not configured');
  }
  return config.r2.workerSecret;
}

function variantKey(keys, variant) {
  return keys?.[variant] || null;
}

router.get('/worker-url', requireAuth, (req, res) => {
  const workerUrl = config.r2.workerUrl;
  if (!workerUrl) {
    return res.status(500).json({ error: 'Upload worker URL not configured' });
  }
  res.json({ data: { workerUrl } });
});

router.post('/token', requireAdminMutation, async (req, res) => {
  try {
    const { albumId } = req.body;
    if (!albumId) return res.status(400).json({ error: 'albumId is required' });
    if (!config.r2.workerUrl) return res.status(500).json({ error: 'Upload worker URL not configured' });

    const { rows } = await pool.query('SELECT id, slug FROM albums WHERE id = $1', [albumId]);
    if (!rows.length) return res.status(404).json({ error: 'Album not found' });

    const allowedPrefix = `albums/${rows[0].slug}`;
    const expiresIn = config.r2.uploadTokenTtlSeconds;
    const uploadToken = jwt.sign(
      {
        purpose: 'r2-upload',
        albumId: rows[0].id,
        allowedPrefix,
        maxBytes: config.r2.maxUploadBytes,
      },
      uploadTokenSecret(),
      { expiresIn }
    );

    res.json({
      data: {
        workerUrl: config.r2.workerUrl,
        uploadToken,
        allowedPrefix,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

router.post('/register', requireAdminMutation, async (req, res) => {
  try {
    const {
      albumId, fileName, width, height, aspectRatio, aspectCategory,
      blurHash, keys, fileSize, sortOrder = 0,
    } = req.body;

    if (!albumId || typeof fileName !== 'string' || !width || !height || !keys) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { rows: albumRows } = await pool.query('SELECT id, slug FROM albums WHERE id = $1', [albumId]);
    if (!albumRows.length) return res.status(404).json({ error: 'Album not found' });

    const prefix = `albums/${albumRows[0].slug}`;
    const keyOriginal = variantKey(keys, 'original');
    const keyThumbnail = variantKey(keys, 'thumbnail');
    const keySmall = variantKey(keys, 'small');
    const keyMedium = variantKey(keys, 'medium');
    const keyWebp = variantKey(keys, 'webp');
    const allKeys = [keyOriginal, keyThumbnail, keySmall, keyMedium, keyWebp];

    if (allKeys.some(key => !isSafeUploadKeyForPrefix(key, prefix))) {
      return res.status(400).json({ error: 'Invalid upload keys' });
    }

    const result = await pool.query(
      `INSERT INTO photos (album_id, file_name, aspect_ratio, aspect_category, width, height,
        blur_hash, url_original, url_thumbnail, url_small, url_medium, url_webp,
        key_original, key_thumbnail, key_small, key_medium, key_webp,
        file_size, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT DO NOTHING RETURNING *`,
      [albumId, fileName, aspectRatio, aspectCategory, width, height, blurHash,
       buildPublicUrl(keyOriginal), buildPublicUrl(keyThumbnail), buildPublicUrl(keySmall),
       buildPublicUrl(keyMedium), buildPublicUrl(keyWebp),
       keyOriginal, keyThumbnail, keySmall, keyMedium, keyWebp,
       fileSize, sortOrder]
    );

    if (!result.rows[0]) {
      return res.status(409).json({ error: 'Photo already exists' });
    }

    await pool.query(`
      UPDATE albums SET
        photo_count = (SELECT COUNT(*) FROM photos WHERE album_id = $1),
        cover_photo_id = COALESCE(cover_photo_id, (SELECT id FROM photos WHERE album_id = $1 ORDER BY sort_order LIMIT 1)),
        updated_at = NOW()
      WHERE id = $1
    `, [albumId]);

    res.status(201).json({ data: sanitizePhoto(result.rows[0], { admin: true }) });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

export default router;
