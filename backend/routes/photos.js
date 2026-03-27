import { Router } from 'express';
import pool from '../services/db.js';
import { deleteFromR2 } from '../services/r2.js';
import { requireAuth } from '../middleware/auth.js';
import { safeError } from '../utils/safeError.js';

const router = Router();

// GET /api/albums/:albumId/photos
router.get('/albums/:albumId/photos', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM photos WHERE album_id = $1 ORDER BY sort_order',
      [req.params.albumId]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// PUT /api/albums/:albumId/photos/reorder
router.put('/albums/:albumId/photos/reorder', requireAuth, async (req, res) => {
  const { items } = req.body; // [{ id, sort_order }]
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query('UPDATE photos SET sort_order = $1 WHERE id = $2 AND album_id = $3', [item.sort_order, item.id, req.params.albumId]);
    }
    await client.query('COMMIT');
    res.json({ data: { success: true } });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: safeError(err) });
  } finally {
    client.release();
  }
});

// PUT /api/photos/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { caption, group_tag } = req.body;
    const result = await pool.query(
      'UPDATE photos SET caption = COALESCE($1, caption), group_tag = COALESCE($2, group_tag) WHERE id = $3 RETURNING *',
      [caption, group_tag, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

async function deletePhotoAndR2(photoId) {
  const result = await pool.query('SELECT * FROM photos WHERE id = $1', [photoId]);
  if (result.rows.length === 0) return;
  const photo = result.rows[0];

  // Extract keys from URLs and delete from R2
  const urlsToDelete = [photo.url_original, photo.url_thumbnail, photo.url_medium, photo.url_webp].filter(Boolean);
  for (const url of urlsToDelete) {
    try {
      // Extract key from URL: everything after the bucket/domain
      const key = url.split('/').slice(3).join('/');
      if (key) await deleteFromR2(key);
    } catch {
      // Continue even if R2 delete fails
    }
  }
  await pool.query('DELETE FROM photos WHERE id = $1', [photoId]);
}

// DELETE /api/photos/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await deletePhotoAndR2(req.params.id);
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// POST /api/photos/bulk-delete
router.post('/bulk-delete', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body; // array of photo IDs
    for (const id of ids) {
      await deletePhotoAndR2(id);
    }
    res.json({ data: { success: true, deleted: ids.length } });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

export default router;
