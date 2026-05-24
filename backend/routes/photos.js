import { Router } from 'express';
import pool from '../services/db.js';
import { deleteFromR2 } from '../services/r2.js';
import { getAdminSession, requireAdminMutation } from '../middleware/auth.js';
import { safeError } from '../utils/safeError.js';
import { sanitizePhoto, sanitizePhotos } from '../utils/photoDto.js';
import { keyForVariant } from '../utils/r2Keys.js';

const router = Router();

// GET /api/albums/:albumId/photos
router.get('/albums/:albumId/photos', async (req, res) => {
  try {
    const isAdmin = !!getAdminSession(req);
    const result = await pool.query(
      `SELECT p.*
       FROM photos p
       JOIN albums a ON a.id = p.album_id
       WHERE p.album_id = $1 AND ($2::boolean OR a.is_published = true)
       ORDER BY p.sort_order`,
      [req.params.albumId, isAdmin]
    );
    res.json({ data: sanitizePhotos(result.rows, { admin: isAdmin }) });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// PUT /api/albums/:albumId/photos/reorder
router.put('/albums/:albumId/photos/reorder', requireAdminMutation, async (req, res) => {
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
router.put('/:id', requireAdminMutation, async (req, res) => {
  try {
    const { caption, group_tag } = req.body;
    const result = await pool.query(
      'UPDATE photos SET caption = COALESCE($1, caption), group_tag = COALESCE($2, group_tag) WHERE id = $3 RETURNING *',
      [caption, group_tag, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ data: sanitizePhoto(result.rows[0], { admin: true }) });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

async function deletePhotoAndR2(photoId) {
  const result = await pool.query('SELECT * FROM photos WHERE id = $1', [photoId]);
  if (result.rows.length === 0) return;
  const photo = result.rows[0];

  // Extract keys from URLs and delete from R2
  const keysToDelete = [
    keyForVariant(photo, 'original'),
    keyForVariant(photo, 'thumbnail'),
    keyForVariant(photo, 'small'),
    keyForVariant(photo, 'medium'),
    keyForVariant(photo, 'webp'),
  ].filter(Boolean);
  for (const key of keysToDelete) {
    try {
      if (key) await deleteFromR2(key);
    } catch {
      // Continue even if R2 delete fails
    }
  }
  await pool.query('DELETE FROM photos WHERE id = $1', [photoId]);
}

// DELETE /api/photos/:id
router.delete('/:id', requireAdminMutation, async (req, res) => {
  try {
    await deletePhotoAndR2(req.params.id);
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// POST /api/photos/bulk-delete
router.post('/bulk-delete', requireAdminMutation, async (req, res) => {
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
