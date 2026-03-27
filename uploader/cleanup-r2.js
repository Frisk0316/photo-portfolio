#!/usr/bin/env node
/**
 * cleanup-r2.js
 * Lists all album directories in R2 and deletes those NOT present in the database.
 *
 * Usage:
 *   node cleanup-r2.js            -- dry run (shows what would be deleted)
 *   node cleanup-r2.js --execute  -- actually delete from R2
 */
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import pg from 'pg';
import { config } from './config.js';

const dryRun = !process.argv.includes('--execute');

const s3 = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
});

const pool = new pg.Pool({ connectionString: config.databaseUrl });

async function listR2AlbumSlugs() {
  const slugs = new Set();
  let continuationToken;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: config.r2.bucketName,
      Prefix: 'albums/',
      Delimiter: '/',
      ContinuationToken: continuationToken,
    }));
    for (const prefix of (res.CommonPrefixes || [])) {
      // prefix.Prefix looks like "albums/20260125-大湖公園落羽松/"
      const slug = prefix.Prefix.replace(/^albums\//, '').replace(/\/$/, '');
      if (slug) slugs.add(slug);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
  } while (continuationToken);
  return slugs;
}

async function listR2ObjectsUnderAlbum(slug) {
  const keys = [];
  let continuationToken;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: config.r2.bucketName,
      Prefix: `albums/${slug}/`,
      ContinuationToken: continuationToken,
    }));
    for (const obj of (res.Contents || [])) keys.push(obj.Key);
    continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
  } while (continuationToken);
  return keys;
}

async function deleteObjects(keys) {
  // DeleteObjects supports up to 1000 keys per request
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map(Key => ({ Key }));
    await s3.send(new DeleteObjectsCommand({
      Bucket: config.r2.bucketName,
      Delete: { Objects: batch, Quiet: true },
    }));
  }
}

async function main() {
  console.log(dryRun ? '=== DRY RUN (pass --execute to actually delete) ===\n' : '=== EXECUTE MODE ===\n');

  // Get DB album slugs
  const { rows } = await pool.query('SELECT slug FROM albums');
  const dbSlugs = new Set(rows.map(r => r.slug));
  console.log(`DB albums (${dbSlugs.size}): ${[...dbSlugs].join(', ')}\n`);

  // Get R2 album slugs
  const r2Slugs = await listR2AlbumSlugs();
  console.log(`R2 albums (${r2Slugs.size}): ${[...r2Slugs].join(', ')}\n`);

  // Find slugs to delete
  const toDelete = [...r2Slugs].filter(s => !dbSlugs.has(s));

  if (toDelete.length === 0) {
    console.log('Nothing to delete — R2 and DB are already in sync.');
    await pool.end();
    return;
  }

  console.log(`Albums to delete from R2 (${toDelete.length}):`);
  for (const slug of toDelete) console.log(`  • ${slug}`);
  console.log('');

  if (dryRun) {
    console.log('Run with --execute to delete the above albums from R2.');
    await pool.end();
    return;
  }

  // Confirm by listing and deleting all objects under each album
  for (const slug of toDelete) {
    process.stdout.write(`Deleting albums/${slug}/ ... `);
    const keys = await listR2ObjectsUnderAlbum(slug);
    if (keys.length === 0) {
      console.log('(no objects found, skipping)');
      continue;
    }
    await deleteObjects(keys);
    console.log(`deleted ${keys.length} objects`);
  }

  console.log('\nDone.');
  await pool.end();
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
