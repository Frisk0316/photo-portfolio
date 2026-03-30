/**
 * R2 Audit Script
 * Lists orphaned files (in R2 but not in DB) and missing files (in DB but not in R2).
 *
 * Usage:
 *   node --env-file=.env audit-r2.js               — show report only
 *   node --env-file=.env audit-r2.js --delete-orphans  — delete orphans after showing report
 *
 * For each orphan, the script shows:
 *   - The R2 key path
 *   - Whether the SAME base filename exists in the DB under the same folder
 *     (= replaced by re-upload), or it is truly unknown
 */

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';
import pool from './services/db.js';

const DELETE_ORPHANS = process.argv.includes('--delete-orphans');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

// ── helpers ─────────────────────────────────────────────────────────────────

async function listAllR2Objects() {
  const objects = [];
  let continuationToken;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: config.r2.bucketName,
      ContinuationToken: continuationToken,
    }));
    for (const obj of res.Contents ?? []) {
      objects.push({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified });
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return objects;
}

function urlToKey(url) {
  if (!url) return null;
  const base = config.r2.publicUrl.replace(/\/$/, '');
  if (url.startsWith(base + '/')) return url.slice(base.length + 1);
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

// Strip variant suffix and timestamp to get a "base" name for comparison.
// e.g.  albums/my-album/IMG_1234_thumb.webp  →  IMG_1234
//        albums/my-album/1710000000000_IMG_1234_medium.webp → IMG_1234
function baseName(key) {
  const filename = key.split('/').pop() ?? key;
  return filename
    .replace(/\.(webp|jpg|jpeg|png|gif)$/i, '')
    .replace(/_(thumb|medium|small|original|webp)$/i, '')
    .replace(/^\d{10,}_/, ''); // strip leading timestamp prefix
}

function folderOf(key) {
  const parts = key.split('/');
  parts.pop();
  return parts.join('/');
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching R2 object list…');
  const r2Objects = await listAllR2Objects();
  const r2Keys = new Set(r2Objects.map(o => o.key));
  console.log(`R2 objects: ${r2Keys.size}`);

  console.log('Fetching DB keys…');
  const photos = await pool.query(
    'SELECT file_name, url_original, url_thumbnail, url_medium, url_webp, url_small FROM photos'
  );

  // Build a set of all R2 keys referenced by the DB
  const dbKeys = new Set();
  // Also build a map: folder → Set of base names currently in DB
  // so we can check if an orphan's base name is "replaced" by a newer upload
  const folderBaseNames = new Map(); // folder → Set<baseName>

  for (const row of photos.rows) {
    for (const col of ['url_original', 'url_thumbnail', 'url_medium', 'url_webp', 'url_small']) {
      const k = urlToKey(row[col]);
      if (!k) continue;
      dbKeys.add(k);
      const folder = folderOf(k);
      if (!folderBaseNames.has(folder)) folderBaseNames.set(folder, new Set());
      folderBaseNames.get(folder).add(baseName(k));
    }
  }

  console.log(`DB references: ${dbKeys.size}`);


  const orphans = r2Objects.filter(o => !dbKeys.has(o.key));
  const missing = [...dbKeys].filter(k => !r2Keys.has(k));

  // ── Orphan report ──────────────────────────────────────────────────────────
  console.log('\n══ ORPHANED FILES (in R2, not in DB) ═══════════════════════════════');

  if (orphans.length === 0) {
    console.log('  None ✓');
  } else {
    // Group by folder for readability
    const byFolder = new Map();
    for (const obj of orphans) {
      const folder = folderOf(obj.key);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push(obj);
    }

    for (const [folder, objs] of [...byFolder.entries()].sort()) {
      const dbBasesInFolder = folderBaseNames.get(folder) ?? new Set();
      console.log(`\n  📁 ${folder || '(root)'}`);
      for (const obj of objs) {
        const bn = baseName(obj.key);
        const filename = obj.key.split('/').pop();
        const kb = (obj.size / 1024).toFixed(1);
        const date = obj.lastModified?.toISOString().slice(0, 10) ?? '?';

        // Is there a current DB entry for the same base filename in this folder?
        const replaced = dbBasesInFolder.has(bn);
        const label = replaced
          ? '  ✅ SAFE TO DELETE — replaced by re-upload'
          : '  ⚠️  UNKNOWN — no matching file in DB for this folder';

        console.log(`     ${filename}  (${kb} KB, uploaded ${date})`);
        console.log(`        ${label}`);
      }
    }
  }

  // ── Missing report ─────────────────────────────────────────────────────────
  console.log('\n══ MISSING FILES (in DB, not in R2) ════════════════════════════════');
  if (missing.length === 0) {
    console.log('  None ✓');
  } else {
    for (const k of missing.sort()) {
      console.log(`  ❌ MISSING  ${k}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const safeOrphans = orphans.filter(o => {
    const folder = folderOf(o.key);
    return (folderBaseNames.get(folder) ?? new Set()).has(baseName(o.key));
  });
  const unknownOrphans = orphans.filter(o => {
    const folder = folderOf(o.key);
    return !(folderBaseNames.get(folder) ?? new Set()).has(baseName(o.key));
  });

  console.log('\n══ SUMMARY ══════════════════════════════════════════════════════════');
  console.log(`  Total R2 objects : ${r2Keys.size}`);
  console.log(`  DB references    : ${dbKeys.size}`);
  console.log(`  Orphaned total   : ${orphans.length}`);
  console.log(`    ✅ Safe (replaced by re-upload) : ${safeOrphans.length}`);
  console.log(`    ⚠️  Unknown (no matching file)  : ${unknownOrphans.length}`);
  console.log(`  Missing from R2  : ${missing.length}`);

  if (unknownOrphans.length > 0) {
    console.log('\n  ⚠️  Review the UNKNOWN orphans manually before deleting.');
    console.log('     They may belong to albums that were fully deleted from the DB,');
    console.log('     or uploaded outside of this system.');
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  if (DELETE_ORPHANS) {
    if (orphans.length === 0) {
      console.log('\nNo orphans to delete.');
    } else {
      const toDelete = orphans; // delete ALL orphans (safe + unknown)
      console.log(`\nDeleting ${toDelete.length} orphan(s)…`);
      for (let i = 0; i < toDelete.length; i += 1000) {
        const batch = toDelete.slice(i, i + 1000).map(o => ({ Key: o.key }));
        const result = await s3.send(new DeleteObjectsCommand({
          Bucket: config.r2.bucketName,
          Delete: { Objects: batch, Quiet: false },
        }));
        const deleted = result.Deleted?.length ?? 0;
        const errors = result.Errors?.length ?? 0;
        console.log(`  Batch ${Math.floor(i / 1000) + 1}: deleted ${deleted}, errors ${errors}`);
        if (errors) result.Errors?.forEach(e => console.log(`    ERROR ${e.Key}: ${e.Message}`));
      }
      console.log('Done.');
    }
  } else if (orphans.length > 0) {
    console.log('\nRun with --delete-orphans to remove them.');
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
