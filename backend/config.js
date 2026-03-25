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
  adminPassword: required('ADMIN_PASSWORD'),
  r2: {
    accountId: optional('R2_ACCOUNT_ID', ''),
    accessKeyId: optional('R2_ACCESS_KEY_ID', ''),
    secretAccessKey: optional('R2_SECRET_ACCESS_KEY', ''),
    bucketName: optional('R2_BUCKET_NAME', 'photo-portfolio'),
    publicUrl: optional('R2_PUBLIC_URL', ''),
    workerUrl: optional('R2_WORKER_URL', ''),
    get endpoint() {
      return `https://${this.accountId}.r2.cloudflarestorage.com`;
    },
  },
  thumbnailHeight: int('THUMBNAIL_HEIGHT', 400),
  mediumWidth: int('MEDIUM_WIDTH', 1600),
  webpQuality: int('WEBP_QUALITY', 82),
  jpegQuality: int('JPEG_QUALITY', 85),
  allowedOrigins: optional('ALLOWED_ORIGINS', 'http://localhost:3000').split(',').map(s => s.trim()),
};
