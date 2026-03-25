#!/usr/bin/env node
import { scanPhotosDirectory, printManifest } from './scanner.js';
import { processImage, classifyAspectRatio } from './processor.js';
import { uploadImageVariants } from './uploader.js';
import { initializeSchema, findOrCreateAlbum, insertPhoto, updateAlbumStats, getExistingPhotos, closeDb } from './db.js';
import { config } from './config.js';

const args = process.argv.slice(2);
const flags = {
  dryRun: args.includes('--dry-run'),
  scanOnly: args.includes('--scan-only'),
  force: args.includes('--force'),
  album: (() => { const idx = args.indexOf('--album'); return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null; })(),
  help: args.includes('--help') || args.includes('-h'),
};

if (flags.help) {
  console.log(`
Photo Portfolio Uploader
  node index.js                Upload all albums
  node index.js --dry-run      Preview what would be uploaded
  node index.js --scan-only    Scan and print manifest only
  node index.js --album "20250104 - WrestleKingdom 19"
  node index.js --force        Re-upload even if photos exist
`);
  process.exit(0);
}

class ProgressTracker {
  constructor(totalAlbums, totalPhotos) {
    this.totalAlbums = totalAlbums; this.totalPhotos = totalPhotos;
    this.currentAlbum = 0; this.currentPhoto = 0;
    this.uploaded = 0; this.skipped = 0; this.failed = 0;
    this.startTime = Date.now(); this.errors = [];
  }
  albumStart(name, count) {
    this.currentAlbum++;
    this.albumPhotoCount = count; this.albumPhotoDone = 0;
    console.log(`\n[${this.currentAlbum}/${this.totalAlbums}] ${name} (${count} photos)`);
  }
  photoComplete(fileName, status) {
    this.currentPhoto++; this.albumPhotoDone++;
    const sym = status === 'uploaded' ? '+' : status === 'skipped' ? '>' : 'x';
    if (status === 'uploaded') this.uploaded++; else if (status === 'skipped') this.skipped++; else this.failed++;
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
    process.stdout.write(`\r  ${sym} [${this.currentPhoto}/${this.totalPhotos}] (${this.albumPhotoDone}/${this.albumPhotoCount}) ${fileName} — ${elapsed}s`);
    if (this.albumPhotoDone === this.albumPhotoCount) console.log('');
  }
  addError(album, file, err) { this.errors.push({ album, file, error: err.message || err }); }
  printSummary() {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(`\n── Upload complete ──`);
    console.log(`  Uploaded: ${this.uploaded}  Skipped: ${this.skipped}  Failed: ${this.failed}  Time: ${elapsed}s`);
    if (this.errors.length > 0) { console.log(`\nErrors:`); for (const e of this.errors) console.log(`  [${e.album}] ${e.file}: ${e.error}`); }
    console.log('');
  }
}

async function processAndUploadPhoto(albumSlug, photo, albumId, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const processed = await processImage(photo.absolutePath);
      const urls = await uploadImageVariants(albumSlug, photo.fileName, processed);
      const aspectCategory = classifyAspectRatio(processed.meta.originalWidth, processed.meta.originalHeight);
      await insertPhoto({
        albumId, fileName: photo.fileName, groupTag: photo.group,
        aspectRatio: processed.meta.aspectRatio, aspectCategory,
        width: processed.meta.originalWidth, height: processed.meta.originalHeight,
        blurHash: processed.meta.blurHash, urlOriginal: urls.original.url,
        urlThumbnail: urls.thumbnail.url, urlMedium: urls.medium.url, urlWebp: urls.webp.url,
        fileSize: processed.original.size, sortOrder: photo.sortOrder,
      });
      return 'uploaded';
    } catch (err) {
      if (attempt < retries) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
      throw err;
    }
  }
}

async function processWithConcurrency(items, concurrency, fn) {
  const results = []; let index = 0;
  async function worker() { while (index < items.length) { const i = index++; results[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function main() {
  console.log('Scanning photo directory...\n');
  const manifest = await scanPhotosDirectory();

  if (flags.album) {
    manifest.albums = manifest.albums.filter(a => a.folderName === flags.album || a.slug === flags.album);
    manifest.totalPhotos = manifest.albums.reduce((sum, a) => sum + a.photoCount, 0);
    if (manifest.albums.length === 0) { console.error(`Album not found: "${flags.album}"`); process.exit(1); }
  }

  printManifest(manifest);
  if (flags.scanOnly) { console.log('(scan-only mode)\n'); process.exit(0); }
  if (flags.dryRun) { console.log('(dry-run mode — run without --dry-run to upload)\n'); process.exit(0); }
  if (manifest.albums.length === 0) { console.log('No albums to upload.\n'); process.exit(0); }

  console.log('Initializing database schema...');
  await initializeSchema();
  console.log('Done.\n');

  const progress = new ProgressTracker(manifest.albums.length, manifest.totalPhotos);

  for (const album of manifest.albums) {
    progress.albumStart(album.folderName, album.photoCount);
    const { id: albumId, existed, existingCount } = await findOrCreateAlbum({
      title: album.title, slug: album.slug, date: album.date,
      folderName: album.folderName, sortOrder: manifest.albums.indexOf(album),
    });
    if (existed) console.log(`  (album exists, ${existingCount} photos in DB)`);
    const existingPhotos = existed ? await getExistingPhotos(albumId) : new Set();

    await processWithConcurrency(album.photos, config.concurrency, async (photo) => {
      if (!flags.force && existingPhotos.has(photo.fileName)) { progress.photoComplete(photo.fileName, 'skipped'); return; }
      try {
        await processAndUploadPhoto(album.slug, photo, albumId);
        progress.photoComplete(photo.fileName, 'uploaded');
      } catch (err) {
        progress.addError(album.folderName, photo.fileName, err);
        progress.photoComplete(photo.fileName, 'failed');
      }
    });
    await updateAlbumStats(albumId);
  }

  progress.printSummary();
  await closeDb();
}

main().catch(err => { console.error('\nFatal error:', err.message); process.exit(1); });
