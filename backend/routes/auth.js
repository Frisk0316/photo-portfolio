import { Router } from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import {
  clearAdminSessionCookie,
  createCsrfToken,
  requireAuth,
  requireCsrf,
  setAdminSessionCookie,
  signAdminSession,
} from '../middleware/auth.js';
import { safeError } from '../utils/safeError.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      username.length > 100 ||
      password.length > 300
    ) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, config.adminPasswordHash);
    if (username !== config.adminUsername || !passwordMatch) {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      console.warn(`[AUTH] Failed login attempt | ip=${ip} time=${new Date().toISOString()}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const csrfToken = createCsrfToken();
    const token = signAdminSession(username, csrfToken);
    setAdminSessionCookie(res, token);
    res.json({ data: { authenticated: true, csrfToken } });
  } catch (err) {
    console.error('[auth/login] error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

router.get('/session', requireAuth, (req, res) => {
  res.json({ data: { authenticated: true, csrfToken: req.user.csrfToken } });
});

router.post('/logout', requireAuth, requireCsrf, (req, res) => {
  clearAdminSessionCookie(res);
  res.json({ data: { authenticated: false } });
});

router.get('/logout-redirect', (req, res) => {
  clearAdminSessionCookie(res);
  res.redirect('/admin/login');
});

export default router;
