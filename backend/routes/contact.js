import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import pool from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

function createTransporter() {
  if (!config.smtp.host) return null;
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });
}

// POST /api/contact — public
router.post('/', contactLimiter, async (req, res) => {
  const { name, email, phone, inquiryType, message, locale } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

  const result = await pool.query(
    `INSERT INTO contact_submissions (name, email, phone, inquiry_type, message, locale)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [name.trim(), email.trim(), phone?.trim() || null, inquiryType || null, message.trim(), locale || 'zh']
  );

  // Send email notification if configured
  const transporter = createTransporter();
  if (transporter && config.smtp.notifyEmail) {
    const inquiryTypeLabel = {
      event: '活動攝影 / Event Photography',
      portrait: '人像攝影 / Portrait Photography',
      commercial: '商業攝影 / Commercial Photography',
      other: '其他 / Other',
    }[inquiryType] || inquiryType || '—';

    transporter.sendMail({
      from: `"Ospreay Photo Contact" <${config.smtp.user}>`,
      to: config.smtp.notifyEmail,
      subject: `[聯繫表單] ${name} — ${inquiryTypeLabel}`,
      text: `姓名: ${name}\n電子信箱: ${email}\n電話: ${phone || '—'}\n需求類型: ${inquiryTypeLabel}\n\n${message}`,
      html: `
        <h2>新的聯繫表單提交</h2>
        <table>
          <tr><td><strong>姓名</strong></td><td>${name}</td></tr>
          <tr><td><strong>Email</strong></td><td>${email}</td></tr>
          <tr><td><strong>電話</strong></td><td>${phone || '—'}</td></tr>
          <tr><td><strong>需求類型</strong></td><td>${inquiryTypeLabel}</td></tr>
        </table>
        <h3>需求說明</h3>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
    }).catch(err => console.error('[CONTACT] Email send error:', err));
  }

  res.json({ data: { id: result.rows[0].id } });
});

// GET /api/contact — admin only
router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM contact_submissions ORDER BY created_at DESC LIMIT 100`
  );
  res.json({ data: rows });
});

// PUT /api/contact/:id/read — admin only
router.put('/:id/read', requireAuth, async (req, res) => {
  const { id } = req.params;
  await pool.query(`UPDATE contact_submissions SET is_read = true WHERE id = $1`, [id]);
  res.json({ data: { id: parseInt(id) } });
});

// DELETE /api/contact/:id — admin only
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  await pool.query(`DELETE FROM contact_submissions WHERE id = $1`, [id]);
  res.json({ data: { id: parseInt(id) } });
});

export default router;
