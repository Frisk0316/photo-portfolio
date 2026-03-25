import { Router } from 'express';
import jwt from 'jsonwebtoken';
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

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (username !== config.adminUsername || password !== config.adminPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ username, role: 'admin' }, config.jwtSecret, { expiresIn: '7d' });
  res.json({ data: { token } });
});

export default router;
