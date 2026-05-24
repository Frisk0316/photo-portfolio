import { Router } from 'express';
import { requireAdminMutation } from '../middleware/auth.js';

const router = Router();

// POST /api/translate
router.post('/', requireAdminMutation, async (req, res) => {
  const { text, from = 'zh-TW', to = 'en' } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Missing text' });
  }
  try {
    const { translate } = await import('google-translate-api-x');
    const result = await Promise.race([
      translate(text.trim(), { from, to }),
      new Promise(resolve => setTimeout(() => resolve(null), 5000)),
    ]);
    res.json({ data: { translated: result?.text || text } });
  } catch (err) {
    // Fallback: return original text so the caller can degrade gracefully
    res.json({ data: { translated: text } });
  }
});

export default router;
