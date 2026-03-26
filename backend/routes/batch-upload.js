import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { encode } from 'blurhash';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pool from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();

// ── Scanner logic (adapted from uploader/scanner.js) ──

const ALBUM_PATTERN = /^(\d{4})(\d{2})(\d{2})\s*-\s*(.+)$/;
const EDITED_FOLDER_NAMES = ['調整後 JPG', '調整後JPG', 'Edited JPG', 'edited'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg']);

function parseAlbumFolder(folderName) {
  const match = folderName.match(ALBUM_PATTERN);
  if (!match) return null;
  const [, year, month, day, title] = match;
  const dateStr = `${year}-${month}-${day}`;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  return { date: dateStr, title: title.trim(), slug: slugify(title.trim()) };
}

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function findEditedFolder(albumPath) {
  const entries = await fs.readdir(albumPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const normalized = entry.name.trim().toLowerCase();
    for (const editedName of EDITED_FOLDER_NAMES) {
      if (normalized === editedName.toLowerCase()) {
        return path.join(albumPath, entry.name);
      }
    }
  }
  return null;
}

async function collectImages(dir) {
  const images = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  for (const entry of sorted) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await collectImages(fullPath);
      images.push(...sub);
    } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      images.push({ absolutePath: fullPath, fileName: entry.name, sortOrder: images.length });
    }
  }
  return images;
}

async function scanDirectory(rootDir) {
  const result = { albums: [], skipped: [], errors: [] };
  let rootEntries;
  try {
    rootEntries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    result.errors.push(`Cannot read directory: ${err.message}`);
    return result;
  }

  const folders = rootEntries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

  for (const folder of folders) {
    const folderPath = path.join(rootDir, folder.name);
    const parsed = parseAlbumFolder(folder.name);

    if (parsed) {
      // Direct album folder
      const editedPath = await findEditedFolder(folderPath);
      if (!editedPath) {
        result.skipped.push({ name: folder.name, reason: '找不到「調整後 JPG」資料夾' });
        continue;
      }
      const images = await collectImages(editedPath);
      if (images.length === 0) {
        result.skipped.push({ name: folder.name, reason: '資料夾是空的' });
        continue;
      }
      result.albums.push({
        folderName: folder.name,
        title: `${parsed.date.replace(/-/g, '')} - ${parsed.title}`,
        albumTitle: parsed.title,
        date: parsed.date,
        slug: parsed.slug,
        editedPath,
        photoCount: images.length,
        photos: images.map(i => ({ fileName: i.fileName, absolutePath: i.absolutePath, sortOrder: i.sortOrder })),
      });
    } else {
      // Possibly a parent folder (e.g., "20251229 ~ 20260107 日本行")
      // Scan inside for album subfolders
      const subEntries = await fs.readdir(folderPath, { withFileTypes: true });
      let foundSub = false;
      for (const sub of subEntries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        const subParsed = parseAlbumFolder(sub.name);
        if (!subParsed) continue;
        foundSub = true;
        const subPath = path.join(folderPath, sub.name);
        const editedPath = await findEditedFolder(subPath);
        if (!editedPath) {
          result.skipped.push({ name: sub.name, reason: '找不到「調整後 JPG」資料夾' });
          continue;
        }
        const images = await collectImages(editedPath);
        if (images.length === 0) {
          result.skipped.push({ name: sub.name, reason: '資料夾是空的' });
          continue;
        }
        result.albums.push({
          folderName: sub.name,
          title: `${subParsed.date.replace(/-/g, '')} - ${subParsed.title}`,
          albumTitle: subParsed.title,
          date: subParsed.date,
          slug: subParsed.slug,
          editedPath,
          photoCount: images.length,
          photos: images.map(i => ({ fileName: i.fileName, absolutePath: i.absolutePath, sortOrder: i.sortOrder })),
        });
      }
      if (!foundSub) {
        result.skipped.push({ name: folder.name, reason: '不符合 YYYYMMDD - 標題 格式' });
      }
    }
  }
  return result;
}

// ── Image processing (adapted from uploader/processor.js) ──

async function processImage(imagePath) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  const [original, thumbnail, medium, webpFull, blurHash] = await Promise.all([
    sharp(imagePath).jpeg({ quality: config.jpegQuality || 85, mozjpeg: true }).toBuffer(),
    sharp(imagePath).resize({ height: config.thumbnailHeight || 400, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer(),
    sharp(imagePath).resize({ width: config.mediumWidth || 1600, withoutEnlargement: true }).jpeg({ quality: config.jpegQuality || 85, mozjpeg: true }).toBuffer(),
    sharp(imagePath).resize({ width: config.mediumWidth || 1600, withoutEnlargement: true }).webp({ quality: config.webpQuality || 82 }).toBuffer(),
    generateBlurHash(imagePath),
  ]);

  return {
    original: { buffer: original, size: original.length },
    thumbnail: { buffer: thumbnail, size: thumbnail.length },
    medium: { buffer: medium, size: medium.length },
    webp: { buffer: webpFull, size: webpFull.length },
    meta: { width, height, aspectRatio: Math.round((width / height) * 1000) / 1000, blurHash },
  };
}

async function generateBlurHash(imagePath) {
  try {
    const { data, info } = await sharp(imagePath).resize(32, 32, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch { return null; }
}

function classifyAspectRatio(w, h) {
  const r = w / h;
  if (Math.abs(r - 4/3) < 0.05) return '4:3';
  if (Math.abs(r - 3/2) < 0.05) return '3:2';
  if (Math.abs(r - 16/9) < 0.05) return '16:9';
  if (Math.abs(r - 1) < 0.05) return '1:1';
  if (Math.abs(r - 3/4) < 0.05) return '3:4';
  if (Math.abs(r - 2/3) < 0.05) return '2:3';
  if (r > 1.2) return 'landscape';
  if (r < 0.8) return 'portrait';
  return 'square';
}

// ── R2 upload ──

let s3Client = null;
function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: config.r2.endpoint,
      credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
    });
  }
  return s3Client;
}

async function uploadToR2(key, buffer, contentType) {
  const s3 = getS3Client();
  await s3.send(new PutObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  const url = config.r2.publicUrl ? `${config.r2.publicUrl}/${key}` : `${config.r2.endpoint}/${config.r2.bucketName}/${key}`;
  return { key, url };
}

async function uploadImageVariants(albumSlug, fileName, processed) {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const prefix = `albums/${albumSlug}`;
  const [original, thumbnail, medium, webp] = await Promise.all([
    uploadToR2(`${prefix}/original/${baseName}.jpg`, processed.original.buffer, 'image/jpeg'),
    uploadToR2(`${prefix}/thumbnail/${baseName}.jpg`, processed.thumbnail.buffer, 'image/jpeg'),
    uploadToR2(`${prefix}/medium/${baseName}.jpg`, processed.medium.buffer, 'image/jpeg'),
    uploadToR2(`${prefix}/webp/${baseName}.webp`, processed.webp.buffer, 'image/webp'),
  ]);
  return { original, thumbnail, medium, webp };
}

// ── Routes ──

// POST /api/batch-upload/scan
router.post('/scan', requireAuth, async (req, res) => {
  try {
    const { rootDir } = req.body;
    if (!rootDir) return res.status(400).json({ error: '請提供根目錄路徑' });

    const result = await scanDirectory(rootDir);
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/batch-upload/execute — SSE stream
router.post('/execute', requireAuth, async (req, res) => {
  const { albums: selectedAlbums } = req.body;
  if (!selectedAlbums || !Array.isArray(selectedAlbums) || selectedAlbums.length === 0) {
    return res.status(400).json({ error: '請選擇至少一個相簿' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  function send(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  let totalUploaded = 0;
  let totalFailed = 0;

  try {
    for (let ai = 0; ai < selectedAlbums.length; ai++) {
      const albumData = selectedAlbums[ai];
      send('album_start', { index: ai, total: selectedAlbums.length, title: albumData.albumTitle, photoCount: albumData.photoCount });

      // Find or create album in DB
      const existingAlbum = await pool.query('SELECT id, photo_count FROM albums WHERE slug = $1', [albumData.slug]);
      let albumId;
      if (existingAlbum.rows.length > 0) {
        albumId = existingAlbum.rows[0].id;
      } else {
        const newAlbum = await pool.query(
          'INSERT INTO albums (title, slug, shot_date, folder_name, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [albumData.albumTitle, albumData.slug, albumData.date, albumData.folderName, 0]
        );
        albumId = newAlbum.rows[0].id;
      }

      // Get existing photos to skip duplicates
      const existingPhotos = await pool.query('SELECT file_name FROM photos WHERE album_id = $1', [albumId]);
      const existingSet = new Set(existingPhotos.rows.map(r => r.file_name));

      for (let pi = 0; pi < albumData.photos.length; pi++) {
        const photo = albumData.photos[pi];

        if (existingSet.has(photo.fileName)) {
          send('photo_progress', { albumIndex: ai, photoIndex: pi, total: albumData.photoCount, fileName: photo.fileName, status: 'skipped' });
          continue;
        }

        try {
          send('photo_progress', { albumIndex: ai, photoIndex: pi, total: albumData.photoCount, fileName: photo.fileName, status: 'processing' });

          const processed = await processImage(photo.absolutePath);
          send('photo_progress', { albumIndex: ai, photoIndex: pi, total: albumData.photoCount, fileName: photo.fileName, status: 'uploading' });

          const urls = await uploadImageVariants(albumData.slug, photo.fileName, processed);
          const aspectCategory = classifyAspectRatio(processed.meta.width, processed.meta.height);

          // Extract EXIF data
          let exifData = null;
          try {
            const metadata = await sharp(photo.absolutePath).metadata();
            if (metadata.exif) {
              const exifParsed = {};
              // sharp provides basic EXIF - store raw metadata fields
              if (metadata.width) exifParsed.Width = metadata.width;
              if (metadata.height) exifParsed.Height = metadata.height;
              if (metadata.density) exifParsed.DPI = metadata.density;
              exifData = exifParsed;
            }
          } catch { /* ignore EXIF errors */ }

          await pool.query(
            `INSERT INTO photos (album_id, file_name, aspect_ratio, aspect_category, width, height, blur_hash,
              url_original, url_thumbnail, url_medium, url_webp, file_size, sort_order, exif_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
            [albumId, photo.fileName, processed.meta.aspectRatio, aspectCategory,
             processed.meta.width, processed.meta.height, processed.meta.blurHash,
             urls.original.url, urls.thumbnail.url, urls.medium.url, urls.webp.url,
             processed.original.size, photo.sortOrder, exifData ? JSON.stringify(exifData) : null]
          );

          totalUploaded++;
          send('photo_progress', { albumIndex: ai, photoIndex: pi, total: albumData.photoCount, fileName: photo.fileName, status: 'done' });
        } catch (err) {
          totalFailed++;
          send('photo_progress', { albumIndex: ai, photoIndex: pi, total: albumData.photoCount, fileName: photo.fileName, status: 'error', error: err.message });
        }
      }

      // Update album stats
      await pool.query(`
        UPDATE albums SET
          photo_count = (SELECT COUNT(*) FROM photos WHERE album_id = $1),
          cover_photo_id = COALESCE(cover_photo_id, (SELECT id FROM photos WHERE album_id = $1 ORDER BY sort_order LIMIT 1)),
          updated_at = NOW()
        WHERE id = $1
      `, [albumId]);

      send('album_complete', { index: ai, title: albumData.albumTitle });
    }

    send('complete', { uploaded: totalUploaded, failed: totalFailed });
  } catch (err) {
    send('error', { message: err.message });
  }

  res.end();
});

export default router;
