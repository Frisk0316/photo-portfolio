import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
let pool = null;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: config.databaseUrl });
  return pool;
}

export async function initializeSchema() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY, name VARCHAR(200) NOT NULL, slug VARCHAR(200) NOT NULL UNIQUE,
      description TEXT, sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS albums (
      id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      title VARCHAR(500) NOT NULL, slug VARCHAR(500) NOT NULL UNIQUE, description TEXT,
      shot_date DATE, folder_name VARCHAR(500), cover_photo_id INTEGER,
      photo_count INTEGER DEFAULT 0, is_published BOOLEAN DEFAULT false,
      sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS photos (
      id SERIAL PRIMARY KEY, album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      file_name VARCHAR(500) NOT NULL, caption TEXT, group_tag VARCHAR(200),
      aspect_ratio REAL, aspect_category VARCHAR(20), width INTEGER, height INTEGER,
      blur_hash VARCHAR(100), url_original TEXT, url_thumbnail TEXT, url_medium TEXT, url_webp TEXT,
      file_size INTEGER, sort_order INTEGER DEFAULT 0, exif_data JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_photos_album_id ON photos(album_id);
    CREATE INDEX IF NOT EXISTS idx_photos_sort_order ON photos(album_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_albums_slug ON albums(slug);
    CREATE INDEX IF NOT EXISTS idx_albums_category ON albums(category_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_albums_shot_date ON albums(shot_date DESC);
  `);
}

export async function findOrCreateAlbum(albumData) {
  const db = getPool();
  const existing = await db.query('SELECT id, photo_count FROM albums WHERE slug = $1', [albumData.slug]);
  if (existing.rows.length > 0) return { id: existing.rows[0].id, existed: true, existingCount: existing.rows[0].photo_count };
  const result = await db.query(
    `INSERT INTO albums (title, slug, shot_date, folder_name, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [albumData.title, albumData.slug, albumData.date, albumData.folderName, albumData.sortOrder || 0]
  );
  return { id: result.rows[0].id, existed: false, existingCount: 0 };
}

export async function insertPhoto(photoData) {
  const db = getPool();
  const result = await db.query(
    `INSERT INTO photos (album_id, file_name, group_tag, aspect_ratio, aspect_category, width, height, blur_hash,
      url_original, url_thumbnail, url_medium, url_webp, file_size, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING RETURNING id`,
    [photoData.albumId, photoData.fileName, photoData.groupTag, photoData.aspectRatio, photoData.aspectCategory,
     photoData.width, photoData.height, photoData.blurHash, photoData.urlOriginal, photoData.urlThumbnail,
     photoData.urlMedium, photoData.urlWebp, photoData.fileSize, photoData.sortOrder]
  );
  return result.rows[0]?.id || null;
}

export async function updateAlbumStats(albumId) {
  const db = getPool();
  await db.query(`
    UPDATE albums SET
      photo_count = (SELECT COUNT(*) FROM photos WHERE album_id = $1),
      cover_photo_id = COALESCE(cover_photo_id, (SELECT id FROM photos WHERE album_id = $1 ORDER BY sort_order LIMIT 1)),
      updated_at = NOW()
    WHERE id = $1
  `, [albumId]);
}

export async function getExistingPhotos(albumId) {
  const db = getPool();
  const result = await db.query('SELECT file_name FROM photos WHERE album_id = $1', [albumId]);
  return new Set(result.rows.map(r => r.file_name));
}

export async function closeDb() {
  if (pool) { await pool.end(); pool = null; }
}
