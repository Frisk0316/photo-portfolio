import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function safeError(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
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
        } catch { /* invalid token — treat as guest */ }
      }
    }
    const whereClause = isAdmin ? '' : 'WHERE a.is_published = true';
    const sort = req.query.sort;
    let orderClause = 'ORDER BY a.shot_date DESC NULLS LAST';
    if (sort === 'date_asc') {
      orderClause = 'ORDER BY a.shot_date ASC NULLS LAST';
    }
    const result = await pool.query(`
      SELECT a.*, c.name as category_name,
        p.url_thumbnail as cover_url
      FROM albums a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN photos p ON a.cover_photo_id = p.id
      ${whereClause}
      ${orderClause}
    `);
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// GET /api/albums/:slug
router.get('/:slug', async (req, res) => {
  try {
    const albumResult = await pool.query(`
      SELECT a.*, c.name as category_name
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
    const { title, description, category_id, shot_date, folder_name, sort_order = 0 } = req.body;
    const slug = slugify(title);
    const result = await pool.query(
      `INSERT INTO albums (title, slug, description, category_id, shot_date, folder_name, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, slug, description, category_id, shot_date, folder_name, sort_order]
    );
    res.status(201).json({ data: result.rows[0] });
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
    const { title, description, category_id, shot_date, is_published, cover_photo_id, cover_crop_data, sort_order } = req.body;
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
        updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [title, slug, description, category_id, shot_date, is_published, cover_photo_id, sort_order, cover_crop_data ? JSON.stringify(cover_crop_data) : null, req.params.id]
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
