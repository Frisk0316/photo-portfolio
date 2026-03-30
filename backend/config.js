import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key, fallback) {
  return process.env[key] || fallback;
}

function int(key, fallback) {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export const config = {
  port: int('PORT', 4000),
  nodeEnv: optional('NODE_ENV', 'development'),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  adminUsername: required('ADMIN_USERNAME'),
  adminPasswordHash: required('ADMIN_PASSWORD_HASH'),
  r2: {
    accountId: optional('R2_ACCOUNT_ID', ''),
    accessKeyId: optional('R2_ACCESS_KEY_ID', ''),
    secretAccessKey: optional('R2_SECRET_ACCESS_KEY', ''),
    bucketName: optional('R2_BUCKET_NAME', 'photo-portfolio'),
    publicUrl: optional('R2_PUBLIC_URL', ''),
    workerUrl: optional('R2_WORKER_URL', ''),
    workerSecret: optional('R2_WORKER_SECRET', ''),
    get endpoint() {
      return `https://${this.accountId}.r2.cloudflarestorage.com`;
    },
  },
  thumbnailHeight: int('THUMBNAIL_HEIGHT', 400),
  mediumWidth: int('MEDIUM_WIDTH', 1600),
  webpQuality: int('WEBP_QUALITY', 82),
  jpegQuality: int('JPEG_QUALITY', 85),
  allowedOrigins: optional('ALLOWED_ORIGINS', '').split(',').map(s => s.trim()).filter(Boolean),
  smtp: {
    host: optional('SMTP_HOST', ''),
    port: int('SMTP_PORT', 587),
    user: optional('SMTP_USER', ''),
    pass: optional('SMTP_PASS', ''),
    notifyEmail: optional('NOTIFY_EMAIL', ''),
  },
  watermarkText: optional('WATERMARK_TEXT', 'Ospreay Photo'),
};

// Startup security warnings
if (config.jwtSecret === 'change-this-to-a-random-string') {
  console.warn('[SECURITY] JWT_SECRET is still the default placeholder — generate a strong secret with: openssl rand -hex 32');
}
if (!config.adminPasswordHash.startsWith('$2')) {
  console.warn('[SECURITY] ADMIN_PASSWORD_HASH does not look like a valid bcrypt hash — run the hash generation script');
}
if (!config.allowedOrigins.length) {
  console.warn('[SECURITY] ALLOWED_ORIGINS is empty — CORS will reject all cross-origin requests');
}
