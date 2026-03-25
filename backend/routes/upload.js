import { Router } from 'express';
import pool from '../services/db.js';
import { downloadFromR2, uploadToR2 } from '../services/r2.js';
import { processImageBuffer, classifyAspectRatio } from '../services/processor.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();

function safeError(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

function isSafeSlug(str) {
  return typeof str === 'string' && /^[a-zA-Z0-9_-]+$/.test(str);
}

function isSafeFileName(str) {
  return typeof str === 'string' && /^[a-zA-Z0-9 ._-]+$/.test(str) && !str.includes('..');
}

// POST /api/upload/presign — return the Worker upload URL and R2 key
router.post('/presign', requireAuth, async (req, res) => {
  try {
    const { albumSlug, fileName, contentType } = req.body;
    if (!albumSlug || !fileName || !contentType) {
      return res.status(400).json({ error: 'albumSlug, fileName, contentType required' });
    }
    if (!isSafeSlug(albumSlug) || !isSafeFileName(fileName)) {
      return res.status(400).json({ error: 'Invalid albumSlug or fileName' });
    }
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const key = `albums/${albumSlug}/original/${baseName}.jpg`;
    const workerUrl = config.r2.workerUrl;
    if (!workerUrl) {
      return res.status(500).json({ error: 'Upload worker URL not configured' });
    }
    res.json({ data: { workerUrl, key } });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// POST /api/upload/process — download original from R2, generate variants, insert DB record
router.post('/process', requireAuth, async (req, res) => {
  try {
    const { albumId, albumSlug, key, fileName, sortOrder = 0 } = req.body;
    if (!albumId || !albumSlug || !key || !fileName) {
      return res.status(400).json({ error: 'albumId, albumSlug, key, and fileName required' });
    }
    if (!isSafeSlug(albumSlug) || !isSafeFileName(fileName)) {
      return res.status(400).json({ error: 'Invalid albumSlug or fileName' });
    }

    // Download the original file from R2 (uploaded by browser via Worker)
    const buffer = await downloadFromR2(key);
    const processed = await processImageBuffer(buffer);
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const prefix = `albums/${albumSlug}`;

    const [origUpload, thumbUpload, mediumUpload, webpUpload] = await Promise.all([
      uploadToR2(`${prefix}/original/${baseName}.jpg`, processed.original.buffer, 'image/jpeg', { variant: 'original' }),
      uploadToR2(`${prefix}/thumbnail/${baseName}.jpg`, processed.thumbnail.buffer, 'image/jpeg', { variant: 'thumbnail' }),
      uploadToR2(`${prefix}/medium/${baseName}.jpg`, processed.medium.buffer, 'image/jpeg', { variant: 'medium' }),
      uploadToR2(`${prefix}/webp/${baseName}.webp`, processed.webp.buffer, 'image/webp', { variant: 'webp' }),
    ]);

    const aspectCategory = classifyAspectRatio(processed.meta.originalWidth, processed.meta.originalHeight);

    const result = await pool.query(
      `INSERT INTO photos (album_id, file_name, aspect_ratio, aspect_category, width, height,
        blur_hash, url_original, url_thumbnail, url_medium, url_webp, file_size, sort_order, exif_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT DO NOTHING RETURNING *`,
      [albumId, fileName, processed.meta.aspectRatio, aspectCategory,
       processed.meta.originalWidth, processed.meta.originalHeight, processed.meta.blurHash,
       origUpload.url, thumbUpload.url, mediumUpload.url, webpUpload.url,
       processed.original.buffer.length, sortOrder, processed.meta.exifData ? JSON.stringify(processed.meta.exifData) : null]
    );

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
    res.status(500).json({ error: safeError(err) });
  }
});

export default router;
