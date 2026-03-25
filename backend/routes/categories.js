import { Router } from 'express';
import pool from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function safeError(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

// GET /api/categories — public
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY sort_order, id');
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// POST /api/categories
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, description, sort_order = 0 } = req.body;
    const slug = slugify(name);
    const result = await pool.query(
      'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, slug, description, sort_order]
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
    const { name, description, sort_order } = req.body;
    const slug = name ? slugify(name) : undefined;
    const result = await pool.query(
      `UPDATE categories SET
        name = COALESCE($1, name),
        slug = COALESCE($2, slug),
        description = COALESCE($3, description),
        sort_order = COALESCE($4, sort_order)
       WHERE id = $5 RETURNING *`,
      [name, slug, description, sort_order, req.params.id]
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
