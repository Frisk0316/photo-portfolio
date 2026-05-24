import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import pool from '../services/db.js';
import { requireAuth, requireAdminMutation } from '../middleware/auth.js';
import { config } from '../config.js';
import { safeError } from '../utils/safeError.js';

const router = Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

const LIMITS = {
  name: 120,
  email: 254,
  phone: 50,
  inquiryType: 40,
  message: 4000,
  locale: 8,
};

function cleanString(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\u0000]/g, ' ').trim().slice(0, max);
}

function cleanMultiline(value, max) {
  if (typeof value !== 'string') return '';
  // Strip NUL, normalize CRLF -> LF, collapse 3+ blank lines.
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

router.post('/', contactLimiter, async (req, res) => {
  try {
    const name = cleanString(req.body.name, LIMITS.name);
    const email = cleanString(req.body.email, LIMITS.email);
    const phone = cleanString(req.body.phone, LIMITS.phone);
    const inquiryType = cleanString(req.body.inquiryType, LIMITS.inquiryType);
    const message = cleanMultiline(req.body.message, LIMITS.message);
    const locale = cleanString(req.body.locale, LIMITS.locale) || 'zh';

    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const result = await pool.query(
      `INSERT INTO contact_submissions (name, email, phone, inquiry_type, message, locale)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, email, phone || null, inquiryType || null, message, locale]
    );

    const transporter = createTransporter();
    if (transporter && config.smtp.notifyEmail) {
      const inquiryTypeLabel = {
        event: 'Event Photography',
        portrait: 'Portrait Photography',
        commercial: 'Commercial Photography',
        other: 'Other',
      }[inquiryType] || inquiryType || 'Other';

      const safe = {
        name: escapeHtml(name),
        email: escapeHtml(email),
        phone: escapeHtml(phone || 'N/A'),
        inquiryTypeLabel: escapeHtml(inquiryTypeLabel),
        message: escapeHtml(message).replace(/\n/g, '<br>'),
      };

      transporter.sendMail({
        from: `"Ospreay Photo Contact" <${config.smtp.user}>`,
        to: config.smtp.notifyEmail,
        subject: `[Portfolio Contact] ${name} - ${inquiryTypeLabel}`,
        text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\nInquiry: ${inquiryTypeLabel}\n\n${message}`,
        html: `
          <h2>New portfolio contact submission</h2>
          <table>
            <tr><td><strong>Name</strong></td><td>${safe.name}</td></tr>
            <tr><td><strong>Email</strong></td><td>${safe.email}</td></tr>
            <tr><td><strong>Phone</strong></td><td>${safe.phone}</td></tr>
            <tr><td><strong>Inquiry</strong></td><td>${safe.inquiryTypeLabel}</td></tr>
          </table>
          <h3>Message</h3>
          <p>${safe.message}</p>
        `,
      }).catch(err => console.error('[CONTACT] Email send error:', err.message));
    }

    res.json({ data: { id: result.rows[0].id } });
  } catch (err) {
    console.error('[contact/create] error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM contact_submissions ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ data: rows });
  } catch (err) {
    console.error('[contact/list] error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

router.put('/:id/read', requireAdminMutation, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE contact_submissions SET is_read = true WHERE id = $1`, [id]);
    res.json({ data: { id: parseInt(id, 10) } });
  } catch (err) {
    console.error('[contact/read] error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

router.delete('/:id', requireAdminMutation, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM contact_submissions WHERE id = $1`, [id]);
    res.json({ data: { id: parseInt(id, 10) } });
  } catch (err) {
    console.error('[contact/delete] error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

export default router;
