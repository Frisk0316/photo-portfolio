import { Router } from 'express';
import pool from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { safeError } from '../utils/safeError.js';

const router = Router();

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/categories — public
router.get('/', async (req, res) => {
  try {
    const { section } = req.query;
    let query = 'SELECT * FROM categories';
    const params = [];
    if (section) {
      params.push(section);
      query += ` WHERE section = $1`;
    }
    query += ' ORDER BY sort_order, id';
    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// POST /api/categories
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, description, sort_order = 0, section = 'other' } = req.body;
    const slug = slugify(name);
    const result = await pool.query(
      'INSERT INTO categories (name, slug, description, sort_order, section) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, slug, description, sort_order, section]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// PUT /api/categories/reorder
router.put('/reorder', requireAuth, async (req, res) => {
  const { items } = req.body; // [{ id, sort_order }]
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query('UPDATE categories SET sort_order = $1 WHERE id = $2', [item.sort_order, item.id]);
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

// PUT /api/categories/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { name, description, sort_order, section } = req.body;
    const slug = name ? slugify(name) : undefined;
    const result = await pool.query(
      `UPDATE categories SET
        name = COALESCE($1, name),
        slug = COALESCE($2, slug),
        description = COALESCE($3, description),
        sort_order = COALESCE($4, sort_order),
        section = COALESCE($5, section)
       WHERE id = $6 RETURNING *`,
      [name, slug, description, sort_order, section, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// DELETE /api/categories/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

export default router;
