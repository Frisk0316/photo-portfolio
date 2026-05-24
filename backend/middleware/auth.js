import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config.js';

export const ADMIN_COOKIE_NAME = 'admin_session';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function cookieOptions(maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  const attrs = [
    `${ADMIN_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.nodeEnv === 'production') attrs.push('Secure');
  return attrs;
}

export function createCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function signAdminSession(username, csrfToken) {
  return jwt.sign(
    { username, role: 'admin', csrfToken },
    config.jwtSecret,
    { expiresIn: SESSION_MAX_AGE_SECONDS }
  );
}

export function setAdminSessionCookie(res, token) {
  const attrs = cookieOptions();
  attrs[0] = `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`;
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearAdminSessionCookie(res) {
  const attrs = cookieOptions(0);
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function getAdminSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[ADMIN_COOKIE_NAME];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded?.role !== 'admin' || typeof decoded.csrfToken !== 'string') return null;
    return decoded;
  } catch {
    return null;
  }
}

function hasAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return config.allowedOrigins.includes(origin);
}

export function requireAuth(req, res, next) {
  const session = getAdminSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = session;
  next();
}

export function requireCsrf(req, res, next) {
  const session = req.user || getAdminSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!hasAllowedOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const csrfToken = req.headers[CSRF_HEADER_NAME];
  if (typeof csrfToken !== 'string' || csrfToken !== session.csrfToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  req.user = session;
  next();
}

export const requireAdminMutation = [requireAuth, requireCsrf];
