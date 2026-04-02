import { Router } from 'express';
import pool from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { safeError } from '../utils/safeError.js';

const router = Router();

// GET /api/homepage-featured?section=events|other
router.get('/', async (req, res) => {
  try {
    const { section } = req.query;
    const params = [];
    let whereClause = '';
    if (section) {
      params.push(section);
      whereClause = `WHERE hf.section = $1`;
    }
    const result = await pool.query(`
      SELECT hf.id, hf.section, hf.sort_order,
        a.id as album_id, a.title, a.title_en, a.slug, a.shot_date,
        a.photo_count, a.cover_crop_data, a.cover_aspect_ratio,
        COALESCE(p.url_medium, p.url_small, p.url_thumbnail) as cover_url
      FROM homepage_featured hf
      JOIN albums a ON hf.album_id = a.id
      LEFT JOIN photos p ON a.cover_photo_id = p.id
      ${whereClause}
      ORDER BY hf.section, hf.sort_order ASC
    `, params);
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// POST /api/homepage-featured  { section, album_id }
router.post('/', requireAuth, async (req, res) => {
  try {
    const { section, album_id } = req.body;
    if (!section || !album_id) {
      return res.status(400).json({ error: 'section and album_id are required' });
    }
    // Get current max sort_order for the section
    const maxResult = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) as max FROM homepage_featured WHERE section = $1',
      [section]
    );
    const nextOrder = maxResult.rows[0].max + 1;
    const result = await pool.query(
      'INSERT INTO homepage_featured (section, album_id, sort_order) VALUES ($1, $2, $3) RETURNING id, section, album_id, sort_order',
      [section, album_id, nextOrder]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '已加入此區塊' });
    res.status(500).json({ error: safeError(err) });
  }
});

// DELETE /api/homepage-featured/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM homepage_featured WHERE id = $1', [req.params.id]);
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// PUT /api/homepage-featured/reorder  { items: [{id, sort_order}] }
router.put('/reorder', requireAuth, async (req, res) => {
  const { items } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query('UPDATE homepage_featured SET sort_order = $1 WHERE id = $2', [item.sort_order, item.id]);
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

export default router;
