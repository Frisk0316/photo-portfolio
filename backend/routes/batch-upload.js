import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { encode } from 'blurhash';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pool from '../services/db.js';
import { requireAdminMutation } from '../middleware/auth.js';
import { config } from '../config.js';
import { safeError } from '../utils/safeError.js';

const router = Router();

const ALBUM_PATTERN = /^(\d{4})(\d{2})(\d{2})\s*-\s*(.+)$/;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg']);

function routeError(err) {
  return err.statusCode && err.statusCode < 500 ? err.message : safeError(err);
}

async function autoTranslate(text) {
  try {
    const { translate } = await import('google-translate-api-x');
    const result = await Promise.race([
      translate(text, { from: 'zh-TW', to: 'en' }),
      new Promise(resolve => setTimeout(() => resolve(null), 5000)),
    ]);
    return result?.text || null;
  } catch {
    return null;
  }
}

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function parseAlbumFolder(folderName) {
  const match = folderName.match(ALBUM_PATTERN);
  if (!match) return null;
  const [, year, month, day, title] = match;
  const dateStr = `${year}-${month}-${day}`;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  return { date: dateStr, title: title.trim(), slug: slugify(title.trim()) };
}

function assertBatchEnabled() {
  if (!config.enableServerBatchUpload) {
    const err = new Error('Server batch upload is disabled');
    err.statusCode = 404;
    throw err;
  }
}

function resolveAllowedPath(inputPath) {
  const normalized = path.resolve(inputPath);
  const allowedRoots = config.batchUploadRoots.map(root => path.resolve(root));
  const allowed = allowedRoots.some(root => {
    const relative = path.relative(root, normalized);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  if (!allowed) {
    const err = new Error('Path is not allowed for server batch upload');
    err.statusCode = 403;
    throw err;
  }
  return normalized;
}

function safeFileBaseName(fileName) {
  const rawBaseName = fileName.replace(/\.[^.]+$/, '');
  const safeName = rawBaseName.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'photo';
  let hash = 0;
  for (let i = 0; i < rawBaseName.length; i++) hash = ((hash << 5) - hash + rawBaseName.charCodeAt(i)) >>> 0;
  return `${safeName}_${hash.toString(36)}`;
}

async function findEditedFolder(albumPath) {
  const entries = await fs.readdir(albumPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const normalized = entry.name.trim().toLowerCase();
    if (config.editedFolderNames.some(name => normalized === name.toLowerCase())) {
      return path.join(albumPath, entry.name);
    }
  }
  return null;
}

async function collectImages(dir, baseDir = dir, images = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  for (const entry of sorted) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectImages(fullPath, baseDir, images);
    } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      images.push({
        absolutePath: fullPath,
        relativePath: path.relative(baseDir, fullPath),
        fileName: entry.name,
        sortOrder: images.length,
      });
    }
  }
  return images;
}

async function tryAddAlbum(result, folderName, folderPath, parsed) {
  const editedPath = await findEditedFolder(folderPath);
  if (!editedPath) {
    result.skipped.push({ name: folderName, reason: 'Edited JPG folder not found' });
    return false;
  }
  const images = await collectImages(editedPath);
  if (!images.length) {
    result.skipped.push({ name: folderName, reason: 'No JPEG images found' });
    return false;
  }
  result.albums.push({
    folderName,
    title: `${parsed.date.replace(/-/g, '')} - ${parsed.title}`,
    albumTitle: parsed.title,
    date: parsed.date,
    slug: parsed.slug,
    editedPath,
    photoCount: images.length,
    photos: images.map(i => ({ fileName: i.fileName, relativePath: i.relativePath, sortOrder: i.sortOrder })),
    _photos: images,
  });
  return true;
}

async function scanFolderForAlbums(result, dirPath, depth = 0) {
  if (depth > 2) return;
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    result.errors.push(`Cannot read directory: ${routeError(err)}`);
    return;
  }

  const folders = entries.filter(e => e.isDirectory()).sort((a, b) => b.name.localeCompare(a.name));
  for (const folder of folders) {
    const folderPath = path.join(dirPath, folder.name);
    const parsed = parseAlbumFolder(folder.name);
    if (parsed) {
      await tryAddAlbum(result, folder.name, folderPath, parsed);
    } else {
      await scanFolderForAlbums(result, folderPath, depth + 1);
    }
  }
}

async function scanDirectory(rootDir) {
  const result = { albums: [], skipped: [], errors: [] };
  const normalizedDir = resolveAllowedPath(rootDir);

  try {
    await fs.access(normalizedDir);
  } catch (err) {
    result.errors.push(`Cannot access root directory: ${routeError(err)}`);
    return result;
  }

  const rootFolderName = path.basename(normalizedDir);
  const rootParsed = parseAlbumFolder(rootFolderName);
  if (rootParsed) {
    await tryAddAlbum(result, rootFolderName, normalizedDir, rootParsed);
  } else {
    await scanFolderForAlbums(result, normalizedDir);
  }
  return result;
}

async function generateBlurHash(imagePath) {
  try {
    const { data, info } = await sharp(imagePath)
      .resize(32, 32, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch {
    return null;
  }
}

async function processImage(imagePath) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  const [original, thumbnail, smallImg, medium, webpFull, blurHash] = await Promise.all([
    sharp(imagePath).jpeg({ quality: config.jpegQuality || 85, mozjpeg: true }).toBuffer(),
    sharp(imagePath).resize({ height: config.thumbnailHeight || 400, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer(),
    sharp(imagePath).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: config.jpegQuality || 85, mozjpeg: true }).toBuffer(),
    sharp(imagePath).resize({ width: config.mediumWidth || 1600, withoutEnlargement: true }).jpeg({ quality: config.jpegQuality || 85, mozjpeg: true }).toBuffer(),
    sharp(imagePath).resize({ width: config.mediumWidth || 1600, withoutEnlargement: true }).webp({ quality: config.webpQuality || 82 }).toBuffer(),
    generateBlurHash(imagePath),
  ]);

  return {
    original: { buffer: original, size: original.length },
    thumbnail: { buffer: thumbnail, size: thumbnail.length },
    small: { buffer: smallImg, size: smallImg.length },
    medium: { buffer: medium, size: medium.length },
    webp: { buffer: webpFull, size: webpFull.length },
    meta: { width, height, aspectRatio: Math.round((width / height) * 1000) / 1000, blurHash },
  };
}

function classifyAspectRatio(w, h) {
  const r = w / h;
  if (Math.abs(r - 4 / 3) < 0.05) return '4:3';
  if (Math.abs(r - 3 / 2) < 0.05) return '3:2';
  if (Math.abs(r - 16 / 9) < 0.05) return '16:9';
  if (Math.abs(r - 1) < 0.05) return '1:1';
  if (Math.abs(r - 3 / 4) < 0.05) return '3:4';
  if (Math.abs(r - 2 / 3) < 0.05) return '2:3';
  if (r > 1.2) return 'landscape';
  if (r < 0.8) return 'portrait';
  return 'square';
}

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
  const baseName = safeFileBaseName(fileName);
  const prefix = `albums/${albumSlug}`;
  const [original, thumbnail, small, medium, webp] = await Promise.all([
    uploadToR2(`${prefix}/original/${baseName}.jpg`, processed.original.buffer, 'image/jpeg'),
    uploadToR2(`${prefix}/thumbnail/${baseName}.jpg`, processed.thumbnail.buffer, 'image/jpeg'),
    uploadToR2(`${prefix}/small/${baseName}.jpg`, processed.small.buffer, 'image/jpeg'),
    uploadToR2(`${prefix}/medium/${baseName}.jpg`, processed.medium.buffer, 'image/jpeg'),
    uploadToR2(`${prefix}/webp/${baseName}.webp`, processed.webp.buffer, 'image/webp'),
  ]);
  return { original, thumbnail, small, medium, webp };
}

router.post('/scan', requireAdminMutation, async (req, res) => {
  try {
    assertBatchEnabled();
    const { rootDir } = req.body;
    if (!rootDir) return res.status(400).json({ error: 'Missing rootDir' });

    const normalized = resolveAllowedPath(rootDir);
    const stat = await fs.stat(normalized);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'rootDir must be a directory' });

    const result = await scanDirectory(normalized);
    const response = {
      ...result,
      albums: result.albums.map(({ _photos, ...album }) => album),
    };
    console.log('[batch-upload/scan] result:', JSON.stringify({ albumCount: response.albums.length }));
    res.json({ data: response });
  } catch (err) {
    console.error('[batch-upload/scan] error:', err.message);
    res.status(err.statusCode || 500).json({ error: routeError(err) });
  }
});

router.post('/execute', requireAdminMutation, async (req, res) => {
  const { albums: selectedAlbums, rootDir } = req.body;
  if (!Array.isArray(selectedAlbums) || selectedAlbums.length === 0) {
    return res.status(400).json({ error: 'No albums selected' });
  }
  if (!rootDir) return res.status(400).json({ error: 'Missing rootDir' });

  try {
    assertBatchEnabled();
    resolveAllowedPath(rootDir);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: routeError(err) });
  }

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
    const scanned = await scanDirectory(rootDir);
    const selectedSlugs = new Set(selectedAlbums.map(album => album.slug).filter(Boolean));
    const albumsToProcess = scanned.albums.filter(album => selectedSlugs.has(album.slug));

    for (let ai = 0; ai < albumsToProcess.length; ai++) {
      const albumData = albumsToProcess[ai];
      send('album_start', { index: ai, total: albumsToProcess.length, title: albumData.albumTitle, photoCount: albumData.photoCount });

      const existingAlbum = await pool.query('SELECT id, photo_count FROM albums WHERE slug = $1', [albumData.slug]);
      let albumId;
      if (existingAlbum.rows.length > 0) {
        albumId = existingAlbum.rows[0].id;
      } else {
        const titleEn = await autoTranslate(albumData.albumTitle);
        const newAlbum = await pool.query(
          'INSERT INTO albums (title, slug, shot_date, folder_name, sort_order, title_en) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [albumData.albumTitle, albumData.slug, albumData.date, albumData.folderName, 0, titleEn]
        );
        albumId = newAlbum.rows[0].id;
      }

      const existingPhotos = await pool.query('SELECT file_name FROM photos WHERE album_id = $1', [albumId]);
      const existingSet = new Set(existingPhotos.rows.map(r => r.file_name));
      const requested = selectedAlbums.find(album => album.slug === albumData.slug);
      const requestedFileNames = new Set((requested?.photos || []).map(photo => photo.fileName));
      const photosToProcess = requestedFileNames.size
        ? albumData._photos.filter(photo => requestedFileNames.has(photo.fileName))
        : albumData._photos;

      for (let pi = 0; pi < photosToProcess.length; pi++) {
        const photo = photosToProcess[pi];
        if (existingSet.has(photo.fileName)) {
          send('photo_progress', { albumIndex: ai, photoIndex: pi, total: photosToProcess.length, fileName: photo.fileName, status: 'skipped' });
          continue;
        }

        try {
          send('photo_progress', { albumIndex: ai, photoIndex: pi, total: photosToProcess.length, fileName: photo.fileName, status: 'processing' });
          const processed = await processImage(photo.absolutePath);
          send('photo_progress', { albumIndex: ai, photoIndex: pi, total: photosToProcess.length, fileName: photo.fileName, status: 'uploading' });

          const urls = await uploadImageVariants(albumData.slug, photo.fileName, processed);
          const aspectCategory = classifyAspectRatio(processed.meta.width, processed.meta.height);

          let exifData = null;
          try {
            const metadata = await sharp(photo.absolutePath).metadata();
            if (metadata.exif) {
              const exifParsed = {};
              if (metadata.width) exifParsed.Width = metadata.width;
              if (metadata.height) exifParsed.Height = metadata.height;
              if (metadata.density) exifParsed.DPI = metadata.density;
              exifData = exifParsed;
            }
          } catch {
            // Ignore EXIF errors.
          }

          await pool.query(
            `INSERT INTO photos (album_id, file_name, aspect_ratio, aspect_category, width, height, blur_hash,
              url_original, url_thumbnail, url_small, url_medium, url_webp,
              key_original, key_thumbnail, key_small, key_medium, key_webp,
              file_size, sort_order, exif_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
             ON CONFLICT DO NOTHING`,
            [albumId, photo.fileName, processed.meta.aspectRatio, aspectCategory,
             processed.meta.width, processed.meta.height, processed.meta.blurHash,
             urls.original.url, urls.thumbnail.url, urls.small.url, urls.medium.url, urls.webp.url,
             urls.original.key, urls.thumbnail.key, urls.small.key, urls.medium.key, urls.webp.key,
             processed.original.size, photo.sortOrder, exifData ? JSON.stringify(exifData) : null]
          );

          totalUploaded++;
          send('photo_progress', { albumIndex: ai, photoIndex: pi, total: photosToProcess.length, fileName: photo.fileName, status: 'done' });
        } catch (err) {
          totalFailed++;
          send('photo_progress', { albumIndex: ai, photoIndex: pi, total: photosToProcess.length, fileName: photo.fileName, status: 'error', error: routeError(err) });
        }
      }

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
    send('error', { message: routeError(err) });
  }

  res.end();
});

export default router;
