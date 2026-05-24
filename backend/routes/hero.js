import { Router } from 'express';
import pool from '../services/db.js';
import { getAdminSession, requireAdminMutation } from '../middleware/auth.js';
import { serveUrl } from '../utils/photoDto.js';
import { safeError } from '../utils/safeError.js';

const router = Router();

const HERO_SELECT = `
  SELECT hi.id, hi.photo_id, hi.sort_order, hi.device, hi.crop_desktop, hi.crop_mobile,
         p.blur_hash, p.width, p.height,
         a.title as album_title
  FROM hero_images hi
  JOIN photos p ON p.id = hi.photo_id
  JOIN albums a ON a.id = p.album_id
`;

function heroDto(row, admin = false) {
  return {
    ...row,
    url_medium: serveUrl(row.photo_id, 'medium', admin),
    url_original: admin ? serveUrl(row.photo_id, 'medium', true) : null,
  };
}

// GET /api/hero-images?device=desktop|mobile
router.get('/', async (req, res) => {
  try {
    const isAdmin = !!getAdminSession(req);
    const device = req.query.device;
    let query = HERO_SELECT;
    const params = [];
    const conditions = [];

    if (device === 'desktop' || device === 'mobile') {
      params.push(device);
      conditions.push(`hi.device = $${params.length}`);
    }
    if (!isAdmin) {
      conditions.push('a.is_published = true');
    }
    if (conditions.length) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY hi.sort_order ASC`;

    const { rows } = await pool.query(query, params);
    res.json({ data: rows.map(row => heroDto(row, isAdmin)) });
  } catch (err) {
    console.error('[hero/list] error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

router.post('/', requireAdminMutation, async (req, res) => {
  try {
    const { photoId, device } = req.body;
    if (!photoId) return res.status(400).json({ error: 'photoId is required' });
    const dev = device === 'mobile' ? 'mobile' : 'desktop';

    const { rows: existing } = await pool.query(
      `SELECT MAX(sort_order) as max_order FROM hero_images WHERE device = $1`,
      [dev]
    );
    const nextOrder = (existing[0].max_order ?? -1) + 1;

    const { rows } = await pool.query(
      `INSERT INTO hero_images (photo_id, sort_order, device) VALUES ($1, $2, $3) RETURNING id`,
      [photoId, nextOrder, dev]
    );
    res.json({ data: { id: rows[0].id } });
  } catch (err) {
    console.error('[hero/create] error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

router.delete('/:id', requireAdminMutation, async (req, res) => {
  try {
    await pool.query(`DELETE FROM hero_images WHERE id = $1`, [req.params.id]);
    res.json({ data: { id: parseInt(req.params.id, 10) } });
  } catch (err) {
    console.error('[hero/delete] error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

router.put('/:id/crop', requireAdminMutation, async (req, res) => {
  try {
    const { crop_desktop, crop_mobile } = req.body;
    await pool.query(
      `UPDATE hero_images SET crop_desktop = $1, crop_mobile = $2 WHERE id = $3`,
      [crop_desktop ? JSON.stringify(crop_desktop) : null, crop_mobile ? JSON.stringify(crop_mobile) : null, req.params.id]
    );
    res.json({ data: { id: parseInt(req.params.id, 10) } });
  } catch (err) {
    console.error('[hero/crop] error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

router.put('/reorder', requireAdminMutation, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

    await Promise.all(
      items.map(({ id, sort_order }) =>
        pool.query(`UPDATE hero_images SET sort_order = $1 WHERE id = $2`, [sort_order, id])
      )
    );
    res.json({ data: { updated: items.length } });
  } catch (err) {
    console.error('[hero/reorder] error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

export default router;
