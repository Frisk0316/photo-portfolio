import { Router } from 'express';
import pool from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/hero-images — public
router.get('/', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT hi.id, hi.photo_id, hi.sort_order, hi.crop_desktop, hi.crop_mobile,
           p.url_medium, p.url_original, p.blur_hash, p.width, p.height,
           a.title as album_title
    FROM hero_images hi
    JOIN photos p ON p.id = hi.photo_id
    JOIN albums a ON a.id = p.album_id
    ORDER BY hi.sort_order ASC
  `);
  res.json({ data: rows });
});

// POST /api/hero-images — admin only
router.post('/', requireAuth, async (req, res) => {
  const { photoId } = req.body;
  if (!photoId) return res.status(400).json({ error: 'photoId is required' });

  const { rows: existing } = await pool.query(
    `SELECT MAX(sort_order) as max_order FROM hero_images`
  );
  const nextOrder = (existing[0].max_order ?? -1) + 1;

  const { rows } = await pool.query(
    `INSERT INTO hero_images (photo_id, sort_order) VALUES ($1, $2) RETURNING id`,
    [photoId, nextOrder]
  );
  res.json({ data: { id: rows[0].id } });
});

// DELETE /api/hero-images/:id — admin only
router.delete('/:id', requireAuth, async (req, res) => {
  await pool.query(`DELETE FROM hero_images WHERE id = $1`, [req.params.id]);
  res.json({ data: { id: parseInt(req.params.id) } });
});

// PUT /api/hero-images/:id/crop — admin only
router.put('/:id/crop', requireAuth, async (req, res) => {
  const { crop_desktop, crop_mobile } = req.body;
  await pool.query(
    `UPDATE hero_images SET crop_desktop = $1, crop_mobile = $2 WHERE id = $3`,
    [crop_desktop ? JSON.stringify(crop_desktop) : null, crop_mobile ? JSON.stringify(crop_mobile) : null, req.params.id]
  );
  res.json({ data: { id: parseInt(req.params.id) } });
});

// PUT /api/hero-images/reorder — admin only
router.put('/reorder', requireAuth, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

  await Promise.all(
    items.map(({ id, sort_order }) =>
      pool.query(`UPDATE hero_images SET sort_order = $1 WHERE id = $2`, [sort_order, id])
    )
  );
  res.json({ data: { updated: items.length } });
});

export default router;
