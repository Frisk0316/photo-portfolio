import { Router } from 'express';
import pool from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const HERO_SELECT = `
  SELECT hi.id, hi.photo_id, hi.sort_order, hi.device, hi.crop_desktop, hi.crop_mobile,
         p.url_medium, p.url_original, p.blur_hash, p.width, p.height,
         a.title as album_title
  FROM hero_images hi
  JOIN photos p ON p.id = hi.photo_id
  JOIN albums a ON a.id = p.album_id
`;

// GET /api/hero-images?device=desktop|mobile — public
router.get('/', async (req, res) => {
  const device = req.query.device;
  let query = HERO_SELECT;
  const params = [];

  if (device === 'desktop' || device === 'mobile') {
    query += ` WHERE hi.device = $1`;
    params.push(device);
  }
  query += ` ORDER BY hi.sort_order ASC`;

  const { rows } = await pool.query(query, params);
  res.json({ data: rows });
});

// POST /api/hero-images — admin only
router.post('/', requireAuth, async (req, res) => {
  const { photoId, device } = req.body;
  if (!photoId) return res.status(400).json({ error: 'photoId is required' });
  const dev = device === 'mobile' ? 'mobile' : 'desktop';

  const { rows: existing } = await pool.query(
    `SELECT MAX(sort_order) as max_order FROM hero_images WHERE device = $1`, [dev]
  );
  const nextOrder = (existing[0].max_order ?? -1) + 1;

  const { rows } = await pool.query(
    `INSERT INTO hero_images (photo_id, sort_order, device) VALUES ($1, $2, $3) RETURNING id`,
    [photoId, nextOrder, dev]
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
