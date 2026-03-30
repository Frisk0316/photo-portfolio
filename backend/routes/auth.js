import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const passwordMatch = typeof password === 'string' && await bcrypt.compare(password, config.adminPasswordHash);
  if (username !== config.adminUsername || !passwordMatch) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    console.warn(`[AUTH] Failed login attempt | user="${username || ''}" ip=${ip} time=${new Date().toISOString()}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ username, role: 'admin' }, config.jwtSecret, { expiresIn: '7d' });
  res.json({ data: { token } });
});

export default router;
