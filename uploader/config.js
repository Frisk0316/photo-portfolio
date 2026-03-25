import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.join(__dirname, '.env') });

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function csvList(key, fallback = '') {
  const val = process.env[key] || fallback;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function int(key, fallback) {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export const config = {
  r2: {
    accountId: required('R2_ACCOUNT_ID'),
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    bucketName: process.env.R2_BUCKET_NAME || 'photo-portfolio',
    publicUrl: process.env.R2_PUBLIC_URL || '',
    get endpoint() {
      return `https://${this.accountId}.r2.cloudflarestorage.com`;
    },
  },
  databaseUrl: required('DATABASE_URL'),
  photosRootDir: required('PHOTOS_ROOT_DIR'),
  editedFolderNames: csvList('EDITED_FOLDER_NAMES', '調整後 JPG,調整後JPG,Edited JPG,edited'),
  skipFolderNames: csvList('SKIP_FOLDER_NAMES', '原始 JPG,原始JPG,Raw JPG,raw'),
  skipExtensions: csvList('SKIP_EXTENSIONS', '.arw,.nef,.cr2,.cr3,.raf,.orf,.rw2,.dng'),
  thumbnailHeight: int('THUMBNAIL_HEIGHT', 400),
  mediumWidth: int('MEDIUM_WIDTH', 1600),
  webpQuality: int('WEBP_QUALITY', 82),
  jpegQuality: int('JPEG_QUALITY', 85),
  concurrency: int('UPLOAD_CONCURRENCY', 4),
};
