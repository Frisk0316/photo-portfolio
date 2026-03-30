import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { safeError } from '../utils/safeError.js';

const router = Router();

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// GET /api/albums
router.get('/', async (req, res) => {
  try {
    let isAdmin = false;
    if (req.query.all === 'true') {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          jwt.verify(authHeader.slice(7), config.jwtSecret);
          isAdmin = true;
        } catch (err) {
          console.warn(`[AUTH] Invalid JWT on album listing | ip=${req.ip || 'unknown'} error=${err.message}`);
        }
      }
    }
    const conditions = [];
    const params = [];
    if (!isAdmin) {
      conditions.push('a.is_published = true');
    }
    const section = req.query.section;
    if (section) {
      params.push(section);
      conditions.push(`c.section = $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sort = req.query.sort;
    let orderClause = 'ORDER BY a.shot_date DESC NULLS LAST';
    if (sort === 'date_asc') {
      orderClause = 'ORDER BY a.shot_date ASC NULLS LAST';
    }
    const result = await pool.query(`
      SELECT a.*, c.name as category_name, c.section as category_section,
        COALESCE(p.url_medium, p.url_small, p.url_thumbnail) as cover_url
      FROM albums a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN photos p ON a.cover_photo_id = p.id
      ${whereClause}
      ${orderClause}
    `, params);
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// GET /api/albums/:slug
router.get('/:slug', async (req, res) => {
  try {
    const albumResult = await pool.query(`
      SELECT a.*, c.name as category_name, c.section as category_section
      FROM albums a
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.slug = $1
    `, [req.params.slug]);
    if (albumResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const album = albumResult.rows[0];

    const photosResult = await pool.query(
      'SELECT * FROM photos WHERE album_id = $1 ORDER BY sort_order',
      [album.id]
    );
    res.json({ data: { ...album, photos: photosResult.rows } });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// POST /api/albums
router.post('/', requireAuth, async (req, res) => {
  try {
    const { title, description, category_id, shot_date, folder_name, sort_order = 0, title_en, description_en } = req.body;
    const slug = slugify(title);
    const existing = await pool.query('SELECT id FROM albums WHERE slug = $1', [slug]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: '已有相同的相簿名稱' });
    }
    const result = await pool.query(
      `INSERT INTO albums (title, slug, description, category_id, shot_date, folder_name, sort_order, title_en, description_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [title, slug, description, category_id, shot_date, folder_name, sort_order, title_en || null, description_en || null]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '已有相同的相簿名稱' });
    res.status(500).json({ error: safeError(err) });
  }
});

// PUT /api/albums/bulk-publish — set all draft albums to published
router.put('/bulk-publish', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE albums SET is_published = true, updated_at = NOW() WHERE is_published = false RETURNING id'
    );
    res.json({ data: { updated: result.rowCount } });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// PUT /api/albums/bulk-archive — set all published albums to draft
router.put('/bulk-archive', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE albums SET is_published = false, updated_at = NOW() WHERE is_published = true RETURNING id'
    );
    res.json({ data: { updated: result.rowCount } });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// PUT /api/albums/reorder
router.put('/reorder', requireAuth, async (req, res) => {
  const { items } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query('UPDATE albums SET sort_order = $1 WHERE id = $2', [item.sort_order, item.id]);
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

// PUT /api/albums/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { title, description, category_id, shot_date, is_published, cover_photo_id, cover_crop_data, sort_order, title_en, description_en, cover_aspect_ratio } = req.body;
    const slug = title ? slugify(title) : undefined;
    const result = await pool.query(
      `UPDATE albums SET
        title = COALESCE($1, title),
        slug = COALESCE($2, slug),
        description = COALESCE($3, description),
        category_id = COALESCE($4, category_id),
        shot_date = COALESCE($5, shot_date),
        is_published = COALESCE($6, is_published),
        cover_photo_id = COALESCE($7, cover_photo_id),
        sort_order = COALESCE($8, sort_order),
        cover_crop_data = COALESCE($9, cover_crop_data),
        title_en = COALESCE($10, title_en),
        description_en = COALESCE($11, description_en),
        cover_aspect_ratio = COALESCE($12, cover_aspect_ratio),
        updated_at = NOW()
       WHERE id = $13 RETURNING *`,
      [title, slug, description, category_id, shot_date, is_published, cover_photo_id, sort_order, cover_crop_data ? JSON.stringify(cover_crop_data) : null, title_en, description_en, cover_aspect_ratio, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// DELETE /api/albums/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM albums WHERE id = $1', [req.params.id]);
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

export default router;
