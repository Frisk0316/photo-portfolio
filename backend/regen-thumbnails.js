/**
 * regen-thumbnails.js
 * Re-generates clean thumbnails and medium images from originals stored in R2.
 * Overwrites existing thumbnail/medium/webp in R2 without touching the DB.
 *
 * Usage:
 *   node --env-file=.env regen-thumbnails.js                  -- all albums
 *   node --env-file=.env regen-thumbnails.js --slug ntw       -- one album by slug (partial match)
 *   node --env-file=.env regen-thumbnails.js --variant thumb  -- only thumbnails
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import pool from './services/db.js';
import { config } from './config.js';

const args = process.argv.slice(2);
const slugFilter = (() => { const i = args.indexOf('--slug'); return i !== -1 ? args[i + 1] : null; })();
const variantFilter = (() => { const i = args.indexOf('--variant'); return i !== -1 ? args[i + 1] : null; })();

const s3 = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
});

function buildKey(url) {
  const base = config.r2.publicUrl.replace(/\/$/, '');
  if (url.startsWith(base + '/')) return url.slice(base.length + 1);
  try { return new URL(url).pathname.replace(/^\//, ''); } catch { return null; }
}

async function downloadFromR2(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: config.r2.bucketName, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function uploadToR2(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

async function regenPhoto(photo, index, total) {
  const origKey = buildKey(photo.url_original);
  if (!origKey) { console.log(`  [${index}/${total}] SKIP ${photo.file_name} — cannot parse original URL`); return; }

  let origBuffer;
  try {
    origBuffer = await downloadFromR2(origKey);
  } catch (err) {
    console.log(`  [${index}/${total}] FAIL ${photo.file_name} — download error: ${err.message}`);
    return;
  }

  const doThumb  = !variantFilter || variantFilter === 'thumb';
  const doMedium = !variantFilter || variantFilter === 'medium';

  try {
    const thumbKey  = buildKey(photo.url_thumbnail);
    const medKey    = buildKey(photo.url_medium);
    const webpKey   = buildKey(photo.url_webp);

    const jobs = [];

    if (doThumb && thumbKey) {
      jobs.push(
        sharp(origBuffer)
          .resize({ height: config.thumbnailHeight || 400, withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer()
          .then(buf => uploadToR2(thumbKey, buf, 'image/jpeg'))
      );
    }

    if (doMedium && medKey) {
      jobs.push(
        sharp(origBuffer)
          .resize({ width: config.mediumWidth || 1600, withoutEnlargement: true })
          .jpeg({ quality: config.jpegQuality || 85, mozjpeg: true })
          .toBuffer()
          .then(buf => uploadToR2(medKey, buf, 'image/jpeg'))
      );
    }

    if (doMedium && webpKey) {
      jobs.push(
        sharp(origBuffer)
          .resize({ width: config.mediumWidth || 1600, withoutEnlargement: true })
          .webp({ quality: config.webpQuality || 82 })
          .toBuffer()
          .then(buf => uploadToR2(webpKey, buf, 'image/webp'))
      );
    }

    await Promise.all(jobs);
    console.log(`  [${index}/${total}] OK  ${photo.file_name}`);
  } catch (err) {
    console.log(`  [${index}/${total}] FAIL ${photo.file_name} — ${err.message}`);
  }
}

async function main() {
  let query = `
    SELECT p.id, p.file_name, p.url_original, p.url_thumbnail, p.url_medium, p.url_webp,
           a.slug as album_slug, a.title as album_title
    FROM photos p
    JOIN albums a ON a.id = p.album_id
  `;
  const params = [];
  if (slugFilter) {
    params.push(`%${slugFilter}%`);
    query += ` WHERE a.slug ILIKE $1`;
  }
  query += ` ORDER BY a.slug, p.sort_order`;

  const { rows } = await pool.query(query, params);
  console.log(`Found ${rows.length} photos${slugFilter ? ` in albums matching "${slugFilter}"` : ''}`);

  // Group by album for cleaner output
  let currentAlbum = null;
  for (let i = 0; i < rows.length; i++) {
    const photo = rows[i];
    if (photo.album_slug !== currentAlbum) {
      currentAlbum = photo.album_slug;
      console.log(`\n── ${photo.album_title} (${photo.album_slug})`);
    }
    await regenPhoto(photo, i + 1, rows.length);
  }

  console.log('\nDone. Remember to Purge Cache in Cloudflare after this.');
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
