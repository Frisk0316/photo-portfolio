#!/usr/bin/env node
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { scanPhotosDirectory, parseAlbumFolder } from './scanner.js';
import { processImage, classifyAspectRatio } from './processor.js';
import { uploadImageVariants } from './uploader.js';
import { initializeSchema, findOrCreateAlbum, insertPhoto, updateAlbumStats, getExistingPhotos, closeDb } from './db.js';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
const guiToken = crypto.randomBytes(32).toString('hex');
const PORT = Number(process.env.UPLOADER_PORT || 4100);
const LOCAL_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
]);

function safeUploaderError(err) {
  if (err?.statusCode && err.statusCode < 500) return err.message;
  if (err?.code) return `Error: ${err.code}`;
  return 'Internal server error';
}

function isAllowedHost(req) {
  const host = String(req.headers.host || '').toLowerCase();
  return host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;
}

function isAllowedLocalNavigation(req) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (origin) return LOCAL_ORIGINS.has(origin);
  if (referer) {
    try {
      const url = new URL(referer);
      return LOCAL_ORIGINS.has(url.origin);
    } catch {
      return false;
    }
  }
  return false;
}

function allowedRoots() {
  return config.allowedRoots.map(root => path.resolve(root));
}

function resolveAllowedPath(inputPath) {
  const normalized = path.resolve(inputPath || config.photosRootDir);
  const allowed = allowedRoots().some(root => {
    const relative = path.relative(root, normalized);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  if (!allowed) {
    const err = new Error('Path is outside the uploader allowlist');
    err.statusCode = 403;
    throw err;
  }
  return normalized;
}

function pathKey(inputPath) {
  return path.resolve(inputPath).toLowerCase();
}

function requestDirs(body) {
  const rawDirs = Array.isArray(body.rootDirs)
    ? body.rootDirs
    : [body.rootDir || config.photosRootDir];
  return rawDirs
    .filter(dir => typeof dir === 'string' && dir.trim())
    .map(dir => resolveAllowedPath(dir));
}

function albumFolderOption(sourceDir, folderName, folderPath, parsed) {
  const normalizedPath = path.resolve(folderPath);
  return {
    id: crypto.createHash('sha1').update(normalizedPath).digest('hex'),
    sourceDir,
    folderName,
    path: normalizedPath,
    relativePath: path.relative(sourceDir, normalizedPath) || folderName,
    date: parsed.date,
    title: parsed.title,
    slug: parsed.slug,
  };
}

async function listAlbumFolders(rootDir) {
  const sourceDir = resolveAllowedPath(rootDir || config.photosRootDir);
  const folders = [];
  const skippedFolders = [];
  const errors = [];

  let entries;
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch (err) {
    errors.push({ path: sourceDir, error: `Cannot read directory: ${err.message}` });
    return { folders, skippedFolders, errors };
  }

  const rootFolderName = path.basename(sourceDir);
  const childFolders = entries.filter(entry => entry.isDirectory());
  const childAlbumFolders = childFolders.filter(entry => parseAlbumFolder(entry.name));

  if (childAlbumFolders.length === 0) {
    const parsedRoot = parseAlbumFolder(rootFolderName);
    if (parsedRoot) {
      folders.push(albumFolderOption(path.dirname(sourceDir), rootFolderName, sourceDir, parsedRoot));
    }
    return { folders, skippedFolders, errors };
  }

  const sortedChildren = childFolders.sort((a, b) => b.name.localeCompare(a.name, 'zh-Hant'));
  for (const folder of sortedChildren) {
    const folderPath = path.join(sourceDir, folder.name);
    const parsed = parseAlbumFolder(folder.name);
    if (parsed) {
      folders.push(albumFolderOption(sourceDir, folder.name, folderPath, parsed));
    } else {
      skippedFolders.push({
        name: folder.name,
        path: folderPath,
        reason: 'Does not match YYYYMMDD or YYYYMMDD - Title format',
      });
    }
  }

  return { folders, skippedFolders, errors };
}

function selectedAlbumPaths(body) {
  if (!Array.isArray(body.albumPaths)) return [];
  return body.albumPaths
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => resolveAllowedPath(item));
}

app.use((req, res, next) => {
  if (!isAllowedHost(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && !isAllowedLocalNavigation(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

app.use('/api', (req, res, next) => {
  if (req.headers['x-uploader-token'] !== guiToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

// ── State ──
let currentUpload = null; // { abort, progress }

// ── API Routes ──

// Get current config
app.get('/api/config', (req, res) => {
  res.json({
    photosRootDir: config.photosRootDir,
    editedFolderNames: config.editedFolderNames,
    concurrency: config.concurrency,
    r2BucketName: config.r2.bucketName,
    r2PublicUrl: config.r2.publicUrl,
  });
});

// Update .env file
app.put('/api/config', async (req, res) => {
  try {
    const envPath = path.join(__dirname, '.env');
    let content = await fs.readFile(envPath, 'utf-8');
    const { photosRootDir, concurrency } = req.body;
    if (photosRootDir !== undefined) {
      const allowedRoot = resolveAllowedPath(photosRootDir);
      content = content.replace(/^PHOTOS_ROOT_DIR=.*/m, `PHOTOS_ROOT_DIR=${allowedRoot}`);
      config.photosRootDir = allowedRoot;
    }
    if (concurrency !== undefined) {
      content = content.replace(/^UPLOAD_CONCURRENCY=.*/m, `UPLOAD_CONCURRENCY=${concurrency}`);
      config.concurrency = concurrency;
    }
    await fs.writeFile(envPath, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    console.error('[uploader/config] error:', err.message);
    res.status(err.statusCode || 500).json({ error: safeUploaderError(err) });
  }
});

// Browse directory
app.post('/api/browse', async (req, res) => {
  try {
    const { dir } = req.body;
    const target = resolveAllowedPath(dir || config.photosRootDir);
    const entries = await fs.readdir(target, { withFileTypes: true });
    const folders = entries
      .filter(e => e.isDirectory())
      .map(e => ({
        name: e.name,
        path: path.join(target, e.name),
        isAlbum: !!parseAlbumFolder(e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = path.dirname(target);
    let safeParent = null;
    try {
      safeParent = parent !== target ? resolveAllowedPath(parent) : null;
    } catch {
      safeParent = null;
    }
    res.json({ current: target, parent: safeParent, folders });
  } catch (err) {
    console.error('[uploader/browse] error:', err.message);
    res.status(err.statusCode || 500).json({ error: safeUploaderError(err) });
  }
});

// List album-looking child folders without scanning every image.
app.post('/api/folders', async (req, res) => {
  try {
    const dirs = requestDirs(req.body);
    const allFolders = [];
    const allSkipped = [];
    const allErrors = [];

    for (const dir of dirs) {
      const listed = await listAlbumFolders(dir);
      allFolders.push(...listed.folders);
      allSkipped.push(...listed.skippedFolders);
      allErrors.push(...listed.errors);
    }

    const seen = new Set();
    const folders = allFolders.filter(folder => {
      const key = pathKey(folder.path);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({
      data: {
        scannedAt: new Date().toISOString(),
        folders,
        skippedFolders: allSkipped,
        errors: allErrors,
      },
    });
  } catch (err) {
    console.error('[uploader/folders] error:', err.message);
    res.status(err.statusCode || 500).json({ error: safeUploaderError(err) });
  }
});

// Scan — accepts rootDirs (array) or legacy rootDir (string)
app.post('/api/scan', async (req, res) => {
  try {
    const albumPaths = selectedAlbumPaths(req.body);
    const dirs = albumPaths.length > 0 ? albumPaths : requestDirs(req.body);

    const allAlbums = [], allSkipped = [], allErrors = [];
    for (const dir of dirs) {
      const m = await scanPhotosDirectory(dir);
      allAlbums.push(...m.albums);
      allSkipped.push(...m.skippedFolders);
      allErrors.push(...m.errors);
    }
    // Deduplicate by album folder path when possible, then by slug.
    const seen = new Set();
    const albums = allAlbums.filter(album => {
      const key = album.editedFolderPath ? pathKey(album.editedFolderPath) : album.slug;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const totalPhotos = albums.reduce((s, a) => s + a.photoCount, 0);
    res.json({ data: { scannedAt: new Date().toISOString(), albums, totalPhotos, skippedFolders: allSkipped, errors: allErrors } });
  } catch (err) {
    console.error('[uploader/scan] error:', err.message);
    res.status(err.statusCode || 500).json({ error: safeUploaderError(err) });
  }
});

// Upload with SSE
app.post('/api/upload', async (req, res) => {
  const { albums: selectedSlugs, force } = req.body;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  function send(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    await initializeSchema();
    const albumPaths = selectedAlbumPaths(req.body);
    const dirs = albumPaths.length > 0 ? albumPaths : requestDirs(req.body);
    console.log('[upload] dirs:', dirs);
    console.log('[upload] selectedAlbumPaths:', albumPaths);
    console.log('[upload] selectedSlugs:', selectedSlugs);

    const allAlbums = [];
    for (const dir of dirs) {
      const m = await scanPhotosDirectory(dir);
      allAlbums.push(...m.albums);
    }
    // Deduplicate by album folder path when possible, then by slug.
    const seen = new Set();
    const scannedAlbums = allAlbums.filter(album => {
      const key = album.editedFolderPath ? pathKey(album.editedFolderPath) : album.slug;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log('[upload] scanned albums:', scannedAlbums.map(a => a.slug));
    const selectedPathSet = albumPaths.length > 0 ? new Set(albumPaths.map(pathKey)) : null;
    const selectedSlugSet = Array.isArray(selectedSlugs) ? new Set(selectedSlugs) : null;
    const albumsToUpload = selectedPathSet
      ? scannedAlbums.filter(a => a.editedFolderPath && selectedPathSet.has(pathKey(a.editedFolderPath)))
      : selectedSlugSet
        ? scannedAlbums.filter(a => selectedSlugSet.has(a.slug))
        : scannedAlbums;
    console.log('[upload] matched albums:', albumsToUpload.length);
    if (albumsToUpload.length > 0) {
      console.log('[upload] first album photos:', albumsToUpload[0].photoCount);
    }

    let totalPhotos = albumsToUpload.reduce((s, a) => s + a.photoCount, 0);
    console.log('[upload] totalPhotos:', totalPhotos);
    let globalPhoto = 0;
    let uploaded = 0, skipped = 0, failed = 0;
    const startTime = Date.now();

    send('start', { totalAlbums: albumsToUpload.length, totalPhotos });

    for (let ai = 0; ai < albumsToUpload.length; ai++) {
      if (aborted) break;
      const album = albumsToUpload[ai];
      send('album_start', { index: ai, total: albumsToUpload.length, name: album.folderName, title: album.title, photoCount: album.photoCount });

      const { id: albumId, existed, existingCount } = await findOrCreateAlbum({
        title: album.title, slug: album.slug, date: album.date,
        folderName: album.folderName, sortOrder: ai,
      });

      const existingPhotos = existed ? await getExistingPhotos(albumId) : new Set();

      for (let pi = 0; pi < album.photos.length; pi++) {
        if (aborted) break;
        const photo = album.photos[pi];
        globalPhoto++;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const avgPer = globalPhoto > 1 ? (Date.now() - startTime) / (globalPhoto - 1) / 1000 : 0;
        const eta = Math.round(avgPer * (totalPhotos - globalPhoto));

        if (!force && existingPhotos.has(photo.fileName)) {
          skipped++;
          send('photo', { albumIndex: ai, photoIndex: pi, global: globalPhoto, totalPhotos, fileName: photo.fileName, status: 'skipped', uploaded, skipped, failed, elapsed, eta });
          continue;
        }

        send('photo', { albumIndex: ai, photoIndex: pi, global: globalPhoto, totalPhotos, fileName: photo.fileName, status: 'processing', uploaded, skipped, failed, elapsed, eta });

        try {
          const processed = await processImage(photo.absolutePath);
          send('photo', { albumIndex: ai, photoIndex: pi, global: globalPhoto, totalPhotos, fileName: photo.fileName, status: 'uploading', uploaded, skipped, failed, elapsed, eta });

          const urls = await uploadImageVariants(album.slug, photo.fileName, processed);
          const aspectCategory = classifyAspectRatio(processed.meta.originalWidth, processed.meta.originalHeight);

          await insertPhoto({
            albumId, fileName: photo.fileName, groupTag: photo.group,
            aspectRatio: processed.meta.aspectRatio, aspectCategory,
            width: processed.meta.originalWidth, height: processed.meta.originalHeight,
            blurHash: processed.meta.blurHash, urlOriginal: urls.original.url,
            urlThumbnail: urls.thumbnail.url, urlMedium: urls.medium.url, urlWebp: urls.webp.url,
            keyOriginal: urls.original.key, keyThumbnail: urls.thumbnail.key,
            keyMedium: urls.medium.key, keyWebp: urls.webp.key,
            fileSize: processed.original.size, sortOrder: photo.sortOrder,
          });

          uploaded++;
          send('photo', { albumIndex: ai, photoIndex: pi, global: globalPhoto, totalPhotos, fileName: photo.fileName, status: 'done', uploaded, skipped, failed, elapsed: ((Date.now() - startTime) / 1000).toFixed(0), eta });
        } catch (err) {
          failed++;
          send('photo', { albumIndex: ai, photoIndex: pi, global: globalPhoto, totalPhotos, fileName: photo.fileName, status: 'error', error: safeUploaderError(err), uploaded, skipped, failed, elapsed, eta });
        }
      }

      await updateAlbumStats(albumId);
      send('album_done', { index: ai, name: album.folderName });
    }

    console.log('[upload] done:', { uploaded, skipped, failed });
    send('complete', { uploaded, skipped, failed, elapsed: ((Date.now() - startTime) / 1000).toFixed(1) });
  } catch (err) {
    console.error('[upload] ERROR:', err);
    send('error', { message: safeUploaderError(err) });
  }

  res.end();
});

// ── Serve GUI ──
function cookieValue(req, name) {
  const cookie = String(req.headers.cookie || '');
  for (const part of cookie.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) return decodeURIComponent(valueParts.join('='));
  }
  return null;
}

app.get('/', (req, res) => {
  const queryToken = typeof req.query.t === 'string' ? req.query.t : '';
  const savedToken = cookieValue(req, 'uploader_token');
  if (queryToken !== guiToken && savedToken !== guiToken) {
    return res.status(403).send('Forbidden');
  }
  if (queryToken === guiToken) {
    res.setHeader('Set-Cookie', `uploader_token=${encodeURIComponent(guiToken)}; Path=/; SameSite=Strict`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(APP_HTML);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Photo Uploader GUI`);
  console.log(`  http://127.0.0.1:${PORT}/?t=${guiToken}`);
  console.log('');
});

// ── Embedded HTML ──
const APP_HTML = /*html*/ `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Photo Uploader</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b0b0c; color: #ece8df; min-height: 100vh; }
  .container { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; padding: 24px 0 40px; }
  .topbar { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
  h1 { font-size: 24px; font-weight: 500; color: #fff; }
  h2 { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.72); }
  .muted { color: rgba(255,255,255,0.42); }
  .tiny { font-size: 12px; }
  .card { background: #121213; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 18px; margin-bottom: 16px; }
  label { display: block; font-size: 12px; color: rgba(255,255,255,0.46); margin-bottom: 6px; }
  input[type="text"], input[type="number"] {
    width: 100%; min-width: 0; padding: 9px 11px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.09);
    background: #1b1b1d; color: #ece8df; font-size: 13px; font-family: Consolas, "SFMono-Regular", monospace; outline: none;
  }
  input:focus { border-color: rgba(255,255,255,0.28); }
  input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; accent-color: #d7d1c5; }
  button { padding: 8px 14px; border-radius: 6px; border: none; font-size: 13px; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s; white-space: nowrap; }
  button:disabled { opacity: 0.42; cursor: not-allowed; }
  .btn-primary { background: #e8e1d4; color: #121213; font-weight: 600; }
  .btn-primary:hover:not(:disabled) { background: #fff7e8; }
  .btn-secondary { background: #1b1b1d; color: rgba(255,255,255,0.68); border: 1px solid rgba(255,255,255,0.09); }
  .btn-secondary:hover:not(:disabled) { border-color: rgba(255,255,255,0.22); color: #fff; }
  .btn-danger { color: #fca5a5; }
  .btn-sm { padding: 5px 10px; font-size: 12px; }
  .row { display: flex; gap: 10px; align-items: end; }
  .row > * { flex: 1 1 auto; }
  .shrink { flex: 0 0 auto; }
  .toolbar { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 14px; }
  .toolbar-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .source-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; margin-bottom: 8px; }
  .source-row.removable { grid-template-columns: minmax(0, 1fr) auto auto auto; }
  .browser { background: #1b1b1d; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; max-height: 260px; overflow-y: auto; margin-top: 10px; }
  .browser-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 11px; cursor: pointer; font-size: 13px; color: rgba(255,255,255,0.66); border-bottom: 1px solid rgba(255,255,255,0.04); }
  .browser-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
  .browser-item.album { color: #86efac; }
  .browser-tag { font-size: 11px; color: rgba(255,255,255,0.35); }
  .table-wrap { overflow-x: auto; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; }
  table { width: 100%; border-collapse: collapse; min-width: 760px; }
  th { text-align: left; font-size: 11px; letter-spacing: 0; color: rgba(255,255,255,0.38); padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,0.07); font-weight: 600; background: rgba(255,255,255,0.02); }
  td { padding: 9px 10px; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
  tr:hover td { background: rgba(255,255,255,0.025); }
  .mono { font-family: Consolas, "SFMono-Regular", monospace; font-size: 12px; color: rgba(255,255,255,0.52); }
  .text-right { text-align: right; }
  .title-cell { color: rgba(255,255,255,0.9); font-weight: 500; }
  .summary { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; font-size: 12px; color: rgba(255,255,255,0.42); }
  .pill { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.62); }
  .progress-bar { width: 100%; height: 7px; background: #1b1b1d; border-radius: 999px; overflow: hidden; margin: 10px 0; }
  .progress-fill { height: 100%; background: #d8cfbf; transition: width 0.25s; }
  .stats { display: flex; gap: 22px; flex-wrap: wrap; font-size: 13px; margin: 12px 0; }
  .stats span { color: rgba(255,255,255,0.44); }
  .stats b { color: #fff; font-weight: 600; }
  .log { background: #0d0d0e; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 12px; font-family: Consolas, "SFMono-Regular", monospace; font-size: 12px; max-height: 420px; overflow-y: auto; line-height: 1.7; }
  .log-ok { color: #86efac; }
  .log-skip { color: rgba(255,255,255,0.34); }
  .log-err { color: #fca5a5; }
  .log-info { color: rgba(255,255,255,0.56); }
  .hidden { display: none; }
  .toast { position: fixed; bottom: 24px; right: 24px; max-width: min(420px, calc(100vw - 48px)); padding: 12px 16px; border-radius: 8px; font-size: 13px; z-index: 100; animation: slideIn 0.18s; background: #151516; border: 1px solid rgba(255,255,255,0.12); }
  .toast-ok { color: #86efac; border-color: rgba(134,239,172,0.35); }
  .toast-err { color: #fca5a5; border-color: rgba(252,165,165,0.35); }
  @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 720px) {
    .topbar { display: block; }
    .source-row, .source-row.removable { grid-template-columns: 1fr; }
    .row { display: block; }
    .row > * + * { margin-top: 8px; }
    button { width: 100%; }
    .toolbar-actions { width: 100%; }
    .toolbar-actions button { flex: 1 1 150px; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="topbar">
    <div>
      <h1>Photo Uploader</h1>
      <p class="muted tiny">Choose album folders locally, then upload only the selected folders.</p>
    </div>
    <span class="pill" id="sessionState">Local session</span>
  </div>

  <div class="card">
    <div class="toolbar">
      <h2>Sources</h2>
      <div class="toolbar-actions">
        <button class="btn-secondary btn-sm" onclick="addRootDir()">Add source</button>
        <button class="btn-secondary btn-sm" onclick="saveConfig()">Save primary</button>
      </div>
    </div>
    <label>Photo source directories</label>
    <div id="rootDirList"></div>
    <div id="browserPanel" class="hidden">
      <div class="browser" id="browser"></div>
    </div>
    <div class="row" style="max-width:220px;margin-top:14px">
      <div>
        <label>Concurrency</label>
        <input type="number" id="concurrency" min="1" max="16" />
      </div>
    </div>
  </div>

  <div class="card">
    <div class="toolbar">
      <h2>Album Folders</h2>
      <div class="toolbar-actions">
        <button class="btn-secondary btn-sm" onclick="toggleAll(true)">Select all</button>
        <button class="btn-secondary btn-sm" onclick="toggleAll(false)">Clear</button>
        <button class="btn-secondary btn-sm" id="scanBtn" onclick="scanSelected()">Scan selected</button>
        <button class="btn-primary" id="listBtn" onclick="listFolders()">List folders</button>
      </div>
    </div>
    <div id="foldersArea">
      <p class="muted tiny">Click "List folders" to show album subfolders and parsed titles.</p>
    </div>
    <div id="skippedArea" class="hidden" style="margin-top:12px">
      <details>
        <summary class="tiny muted" style="cursor:pointer">Skipped folders</summary>
        <div id="skippedList" class="tiny muted" style="margin-top:8px"></div>
      </details>
    </div>
  </div>

  <div class="card hidden" id="uploadCard">
    <div class="toolbar">
      <h2 id="uploadTitle">Upload</h2>
      <div class="toolbar-actions">
        <label style="display:flex;align-items:center;gap:7px;margin:0;cursor:pointer">
          <input type="checkbox" id="forceUpload" />
          <span class="tiny muted">Force re-upload</span>
        </label>
        <button class="btn-primary" id="uploadBtn" onclick="startUpload()">Upload selected</button>
      </div>
    </div>
    <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
    <div class="stats" id="statsBar">
      <span>Uploaded: <b id="statUp">0</b></span>
      <span>Skipped: <b id="statSkip">0</b></span>
      <span>Failed: <b id="statFail">0</b></span>
      <span>ETA: <b id="statEta">--</b></span>
    </div>
    <div class="log" id="log"></div>
  </div>
</div>

<script>
const params = new URLSearchParams(window.location.search);
const tokenFromQuery = params.get('t');
if (tokenFromQuery) {
  sessionStorage.setItem('uploader_token', tokenFromQuery);
  window.history.replaceState(null, '', window.location.pathname);
}

function readCookie(name) {
  const parts = document.cookie.split(';').map(function(part) { return part.trim(); });
  for (const part of parts) {
    if (part.indexOf(name + '=') === 0) return decodeURIComponent(part.slice(name.length + 1));
  }
  return '';
}

const UPLOADER_TOKEN = sessionStorage.getItem('uploader_token') || readCookie('uploader_token');

function apiFetch(url, options) {
  options = options || {};
  if (!UPLOADER_TOKEN) throw new Error('Uploader session is missing. Open the tokenized URL printed in the terminal.');
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Uploader-Token': UPLOADER_TOKEN,
    },
  });
}

let rootDirs = [''];
let browsingIndex = 0;
let browserEntries = [];
let folderOptions = [];
let skippedFolders = [];
let scanData = null;

function html(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
  });
}

function mb(bytes) {
  return (Number(bytes || 0) / 1024 / 1024).toFixed(1);
}

function selectedRoots() {
  return rootDirs.map(function(dir) { return dir.trim(); }).filter(Boolean);
}

function selectedFolders() {
  return folderOptions.filter(function(folder) { return folder.selected; });
}

function selectedFolderPaths() {
  return selectedFolders().map(function(folder) { return folder.path; });
}

function keyPath(value) {
  return String(value || '').toLowerCase();
}

function renderRootDirs() {
  const container = document.getElementById('rootDirList');
  let out = '';
  rootDirs.forEach(function(dir, index) {
    const removable = rootDirs.length > 1;
    out += '<div class="source-row' + (removable ? ' removable' : '') + '">';
    out += '<input type="text" value="' + html(dir) + '" oninput="rootDirs[' + index + ']=this.value" />';
    out += '<button class="btn-secondary" onclick="openBrowser(' + index + ')">Browse</button>';
    out += '<button class="btn-secondary" onclick="useAsOnlySource(' + index + ')">Only</button>';
    if (removable) out += '<button class="btn-secondary btn-danger" onclick="removeRootDir(' + index + ')">Remove</button>';
    out += '</div>';
  });
  container.innerHTML = out;
}

function addRootDir() {
  rootDirs.push('');
  renderRootDirs();
}

function removeRootDir(index) {
  rootDirs.splice(index, 1);
  if (!rootDirs.length) rootDirs.push('');
  renderRootDirs();
}

function useAsOnlySource(index) {
  rootDirs = [rootDirs[index] || ''];
  browsingIndex = 0;
  renderRootDirs();
}

async function loadConfig() {
  try {
    const response = await apiFetch('/api/config');
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error);
    rootDirs = [payload.photosRootDir || ''];
    renderRootDirs();
    document.getElementById('concurrency').value = payload.concurrency || 4;
    document.getElementById('sessionState').textContent = payload.r2BucketName ? 'R2: ' + payload.r2BucketName : 'Local session';
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveConfig() {
  try {
    const concurrency = parseInt(document.getElementById('concurrency').value, 10) || 4;
    const response = await apiFetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photosRootDir: rootDirs[0] || '', concurrency: concurrency }),
    });
    const payload = await response.json().catch(function() { return {}; });
    if (!response.ok || payload.error) throw new Error(payload.error || 'Failed to save settings');
    toast('Settings saved');
  } catch (err) {
    toast(err.message, true);
  }
}

function openBrowser(index) {
  browsingIndex = index;
  document.getElementById('browserPanel').classList.remove('hidden');
  browse(rootDirs[index] || '');
}

async function browse(dir) {
  try {
    const response = await apiFetch('/api/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: dir }),
    });
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error);

    browserEntries = [];
    let out = '';
    if (payload.parent) {
      browserEntries.push({ type: 'parent', path: payload.parent });
      out += '<div class="browser-item" onclick="pickBrowserEntry(0)"><span>..</span><span class="browser-tag">parent</span></div>';
    }
    payload.folders.forEach(function(folder) {
      const index = browserEntries.length;
      browserEntries.push({ type: 'folder', path: folder.path });
      out += '<div class="browser-item' + (folder.isAlbum ? ' album' : '') + '" onclick="pickBrowserEntry(' + index + ')">';
      out += '<span>' + html(folder.name) + '</span><span class="browser-tag">' + (folder.isAlbum ? 'album' : 'folder') + '</span></div>';
    });
    document.getElementById('browser').innerHTML = out || '<div class="muted tiny" style="padding:12px">Empty folder</div>';
  } catch (err) {
    toast(err.message, true);
  }
}

function pickBrowserEntry(index) {
  const entry = browserEntries[index];
  if (!entry) return;
  if (entry.type === 'parent') {
    browse(entry.path);
    return;
  }
  rootDirs[browsingIndex] = entry.path;
  renderRootDirs();
  browse(entry.path);
}

async function listFolders() {
  const btn = document.getElementById('listBtn');
  btn.disabled = true;
  btn.textContent = 'Listing...';
  try {
    const dirs = selectedRoots();
    if (!dirs.length) throw new Error('Add at least one source directory');
    const response = await apiFetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDirs: dirs }),
    });
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error);
    const previouslySelected = new Set(selectedFolderPaths().map(keyPath));
    folderOptions = (payload.data.folders || []).map(function(folder) {
      const key = keyPath(folder.path);
      return { ...folder, selected: previouslySelected.size ? previouslySelected.has(key) : true, scanned: false };
    });
    skippedFolders = payload.data.skippedFolders || [];
    scanData = null;
    renderFolderOptions();
    renderSkipped();
    toast('Found ' + folderOptions.length + ' album folder' + (folderOptions.length === 1 ? '' : 's'));
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'List folders';
  }
}

async function scanSelected() {
  const paths = selectedFolderPaths();
  if (!paths.length) {
    toast('Select at least one folder to scan', true);
    return;
  }

  const btn = document.getElementById('scanBtn');
  btn.disabled = true;
  btn.textContent = 'Scanning...';
  try {
    const response = await apiFetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumPaths: paths }),
    });
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error);
    scanData = payload.data;

    const byPath = new Map();
    (scanData.albums || []).forEach(function(album) {
      byPath.set(keyPath(album.editedFolderPath), album);
    });

    folderOptions = folderOptions.map(function(folder) {
      const album = byPath.get(keyPath(folder.path));
      if (!album) return { ...folder, scanned: false, photoCount: null, totalSize: null };
      return { ...folder, scanned: true, photoCount: album.photoCount, totalSize: album.totalSize, groups: album.groups || [] };
    });

    skippedFolders = (scanData.skippedFolders || []).concat(skippedFolders || []);
    renderFolderOptions();
    renderSkipped();
    toast('Scanned ' + (scanData.albums || []).length + ' selected folder' + ((scanData.albums || []).length === 1 ? '' : 's'));
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan selected';
  }
}

function renderFolderOptions() {
  const area = document.getElementById('foldersArea');
  if (!folderOptions.length) {
    area.innerHTML = '<p class="muted tiny">No album folders found. Album folders should match YYYYMMDD or YYYYMMDD - Title.</p>';
    document.getElementById('uploadCard').classList.add('hidden');
    return;
  }

  const selected = selectedFolders();
  const knownSelected = selected.filter(function(folder) { return Number.isFinite(folder.photoCount); });
  const knownPhotos = knownSelected.reduce(function(sum, folder) { return sum + Number(folder.photoCount || 0); }, 0);
  const knownSize = knownSelected.reduce(function(sum, folder) { return sum + Number(folder.totalSize || 0); }, 0);

  let out = '<div class="summary">';
  out += '<span class="pill">' + selected.length + ' selected</span>';
  out += '<span>' + folderOptions.length + ' folders listed</span>';
  if (knownSelected.length) out += '<span>' + knownPhotos + ' photos scanned, ' + mb(knownSize) + ' MB</span>';
  else out += '<span>Scan selected to preview photo counts before uploading.</span>';
  out += '</div>';

  out += '<div class="table-wrap"><table><thead><tr>';
  out += '<th style="width:38px"></th><th>Date</th><th>Title</th><th>Folder</th><th class="text-right">Photos</th><th class="text-right">Size</th><th>Source</th>';
  out += '</tr></thead><tbody>';
  folderOptions.forEach(function(folder, index) {
    out += '<tr>';
    out += '<td><input type="checkbox" ' + (folder.selected ? 'checked' : '') + ' onchange="setFolderSelected(' + index + ', this.checked)"></td>';
    out += '<td class="mono">' + html(folder.date) + '</td>';
    out += '<td class="title-cell">' + html(folder.title) + '</td>';
    out += '<td class="mono">' + html(folder.folderName) + '</td>';
    out += '<td class="text-right mono">' + (Number.isFinite(folder.photoCount) ? folder.photoCount : '-') + '</td>';
    out += '<td class="text-right mono">' + (Number.isFinite(folder.totalSize) ? mb(folder.totalSize) + ' MB' : '-') + '</td>';
    out += '<td class="mono">' + html(folder.sourceDir || '') + '</td>';
    out += '</tr>';
  });
  out += '</tbody></table></div>';
  area.innerHTML = out;
  updateUploadBtn();
}

function setFolderSelected(index, checked) {
  if (!folderOptions[index]) return;
  folderOptions[index].selected = checked;
  renderFolderOptions();
}

function toggleAll(value) {
  folderOptions.forEach(function(folder) { folder.selected = value; });
  renderFolderOptions();
}

function updateUploadBtn() {
  const card = document.getElementById('uploadCard');
  const button = document.getElementById('uploadBtn');
  const selected = selectedFolders();
  card.classList.toggle('hidden', folderOptions.length === 0);
  const knownPhotos = selected.reduce(function(sum, folder) {
    return sum + (Number.isFinite(folder.photoCount) ? Number(folder.photoCount) : 0);
  }, 0);
  const hasCounts = selected.some(function(folder) { return Number.isFinite(folder.photoCount); });
  button.disabled = selected.length === 0;
  button.textContent = 'Upload ' + selected.length + ' folder' + (selected.length === 1 ? '' : 's') + (hasCounts ? ' (' + knownPhotos + ' photos)' : '');
}

function renderSkipped() {
  const area = document.getElementById('skippedArea');
  const list = document.getElementById('skippedList');
  if (!skippedFolders.length) {
    area.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  area.classList.remove('hidden');
  list.innerHTML = skippedFolders.map(function(item) {
    return '<div>' + html(item.name || item.path || 'Folder') + ' - ' + html(item.reason || item.error || 'Skipped') + '</div>';
  }).join('');
}

function resetProgress() {
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('statUp').textContent = '0';
  document.getElementById('statSkip').textContent = '0';
  document.getElementById('statFail').textContent = '0';
  document.getElementById('statEta').textContent = '--';
  document.getElementById('log').innerHTML = '';
}

async function startUpload() {
  const paths = selectedFolderPaths();
  if (!paths.length) {
    toast('Select at least one folder to upload', true);
    return;
  }

  const btn = document.getElementById('uploadBtn');
  btn.disabled = true;
  resetProgress();

  try {
    const force = document.getElementById('forceUpload').checked;
    const response = await apiFetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumPaths: paths, force: force }),
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(function() { return {}; });
      throw new Error(payload.error || 'Upload request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const read = await reader.read();
      if (read.done) break;
      buffer += decoder.decode(read.value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop();

      let eventName = '';
      for (const line of lines) {
        if (line.indexOf('event: ') === 0) eventName = line.slice(7).trim();
        else if (line.indexOf('data: ') === 0 && eventName) {
          try { handleSSE(eventName, JSON.parse(line.slice(6))); } catch {}
          eventName = '';
        }
      }
    }
  } catch (err) {
    appendLog('log-err', 'Error: ' + err.message);
    toast(err.message, true);
  } finally {
    btn.disabled = selectedFolders().length === 0;
    updateUploadBtn();
  }
}

function appendLog(className, text) {
  const log = document.getElementById('log');
  const line = document.createElement('div');
  line.className = className;
  line.textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  return line;
}

function handleSSE(event, data) {
  if (event === 'start') {
    document.getElementById('uploadTitle').textContent = 'Uploading ' + data.totalAlbums + ' folder' + (data.totalAlbums === 1 ? '' : 's');
    appendLog('log-info', 'Starting upload: ' + data.totalAlbums + ' folders, ' + data.totalPhotos + ' photos');
    return;
  }

  if (event === 'album_start') {
    appendLog('log-info', 'Album [' + (data.index + 1) + '/' + data.total + '] ' + (data.title || data.name) + ' - ' + data.photoCount + ' photos');
    return;
  }

  if (event === 'photo') {
    const id = 'photo-' + data.global;
    let line = document.getElementById(id);
    const progress = '[' + data.global + '/' + data.totalPhotos + ']';
    const etaText = data.eta > 0 ? ' | ETA ' + formatEta(data.eta) : '';
    let className = 'log-info';
    let text = progress + ' ' + data.fileName + ' - ' + data.status + etaText;

    if (data.status === 'done') {
      className = 'log-ok';
      text = progress + ' ' + data.fileName + ' - done in ' + data.elapsed + 's' + etaText;
    } else if (data.status === 'skipped') {
      className = 'log-skip';
      text = progress + ' ' + data.fileName + ' - skipped' + etaText;
    } else if (data.status === 'error') {
      className = 'log-err';
      text = progress + ' ' + data.fileName + ' - ' + data.error + etaText;
    }

    if (!line) {
      line = document.createElement('div');
      line.id = id;
      document.getElementById('log').appendChild(line);
    }
    line.className = className;
    line.textContent = text;

    const log = document.getElementById('log');
    log.scrollTop = log.scrollHeight;
    document.getElementById('statUp').textContent = data.uploaded;
    document.getElementById('statSkip').textContent = data.skipped;
    document.getElementById('statFail').textContent = data.failed;
    document.getElementById('statEta').textContent = data.eta > 0 ? formatEta(data.eta) : '--';
    document.getElementById('progressFill').style.width = (data.totalPhotos > 0 ? (data.global / data.totalPhotos * 100) : 0) + '%';
    return;
  }

  if (event === 'album_done') {
    appendLog('log-info', 'Finished album: ' + data.name);
    return;
  }

  if (event === 'complete') {
    appendLog('log-info', 'Complete: ' + data.uploaded + ' uploaded, ' + data.skipped + ' skipped, ' + data.failed + ' failed (' + data.elapsed + 's)');
    document.getElementById('statEta').textContent = 'Done';
    document.getElementById('progressFill').style.width = '100%';
    toast('Upload complete: ' + data.uploaded + ' uploaded');
    return;
  }

  if (event === 'error') {
    appendLog('log-err', 'Error: ' + data.message);
    toast(data.message, true);
  }
}

function formatEta(seconds) {
  seconds = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? minutes + 'm ' + rest + 's' : rest + 's';
}

function toast(message, isError) {
  const el = document.createElement('div');
  el.className = 'toast ' + (isError ? 'toast-err' : 'toast-ok');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 3200);
}

renderRootDirs();
loadConfig();
</script>
</body>
</html>`;

const HTML = /*html*/ `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Photo Uploader</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e8e6e1; min-height: 100vh; }
  .container { max-width: 900px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; font-weight: 400; margin-bottom: 32px; color: #fff; }
  h2 { font-size: 14px; font-weight: 500; color: rgba(255,255,255,0.5); margin-bottom: 12px; }
  .card { background: #111; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 20px; margin-bottom: 20px; }
  label { display: block; font-size: 12px; color: rgba(255,255,255,0.4); margin-bottom: 6px; }
  input[type="text"], input[type="number"] {
    width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);
    background: #1a1a1a; color: #e8e6e1; font-size: 13px; font-family: 'Consolas', monospace; outline: none;
  }
  input:focus { border-color: rgba(255,255,255,0.2); }
  .row { display: flex; gap: 12px; align-items: flex-end; }
  .row > * { flex: 1; }
  .row > .shrink { flex: 0 0 auto; }
  button {
    padding: 8px 20px; border-radius: 6px; border: none; font-size: 13px; cursor: pointer; transition: all 0.15s;
  }
  .btn-primary { background: rgba(255,255,255,0.85); color: #0a0a0a; font-weight: 500; }
  .btn-primary:hover { background: #fff; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-secondary { background: #1a1a1a; color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.06); }
  .btn-secondary:hover { border-color: rgba(255,255,255,0.15); color: #fff; }
  .btn-sm { padding: 4px 12px; font-size: 12px; }

  /* Browser */
  .browser { background: #1a1a1a; border-radius: 6px; max-height: 260px; overflow-y: auto; margin: 8px 0; }
  .browser-item { display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer; font-size: 13px; color: rgba(255,255,255,0.6); border-bottom: 1px solid rgba(255,255,255,0.03); }
  .browser-item:hover { background: rgba(255,255,255,0.04); color: #fff; }
  .browser-item.album { color: rgba(74,222,128,0.8); }
  .browser-parent { color: rgba(255,255,255,0.3); font-style: italic; }

  /* Albums table */
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; color: rgba(255,255,255,0.3); padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); font-weight: 400; }
  td { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.03); }
  tr:hover { background: rgba(255,255,255,0.02); }
  .mono { font-family: 'Consolas', monospace; font-size: 12px; color: rgba(255,255,255,0.4); }
  .text-right { text-align: right; }
  input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }

  /* Progress */
  .progress-bar { width: 100%; height: 6px; background: #1a1a1a; border-radius: 3px; overflow: hidden; margin: 8px 0; }
  .progress-fill { height: 100%; background: rgba(255,255,255,0.6); transition: width 0.3s; border-radius: 3px; }
  .log { background: #0d0d0d; border-radius: 6px; padding: 12px; font-family: 'Consolas', monospace; font-size: 12px; max-height: 400px; overflow-y: auto; line-height: 1.8; }
  .log-ok { color: rgb(74,222,128); }
  .log-skip { color: rgba(255,255,255,0.3); }
  .log-err { color: rgb(248,113,113); }
  .log-info { color: rgba(255,255,255,0.5); }
  .stats { display: flex; gap: 24px; font-size: 13px; margin-top: 12px; }
  .stats span { color: rgba(255,255,255,0.4); }
  .stats b { color: #fff; font-weight: 500; }
  .hidden { display: none; }

  /* Toast */
  .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: 8px; font-size: 13px; z-index: 100; animation: slideIn 0.2s; }
  .toast-ok { background: #111; border: 1px solid rgba(74,222,128,0.4); color: rgb(74,222,128); }
  .toast-err { background: #111; border: 1px solid rgba(248,113,113,0.4); color: rgb(248,113,113); }
  @keyframes slideIn { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform: translateY(0); } }
</style>
</head>
<body>
<div class="container">
  <h1>Photo Uploader</h1>

  <!-- Config -->
  <div class="card">
    <h2>Settings</h2>
    <div style="margin-bottom:12px">
      <label>Photos Source Directories</label>
      <div id="rootDirList"></div>
      <button class="btn-secondary btn-sm" style="margin-top:8px" onclick="addRootDir()">+ Add Folder</button>
      <button class="btn-secondary btn-sm" style="margin-top:8px;margin-left:8px" onclick="saveConfig()">Save Primary</button>
    </div>
    <div id="browserPanel" class="hidden">
      <div class="browser" id="browser"></div>
    </div>
    <div class="row" style="max-width:200px">
      <div>
        <label>Concurrency</label>
        <input type="number" id="concurrency" min="1" max="16" />
      </div>
    </div>
  </div>

  <!-- Scan -->
  <div class="card">
    <div class="row" style="align-items:center; margin-bottom:16px">
      <h2 style="margin:0">Albums</h2>
      <div class="shrink" style="display:flex;gap:8px">
        <button class="btn-secondary btn-sm" onclick="toggleAll(true)">Select All</button>
        <button class="btn-secondary btn-sm" onclick="toggleAll(false)">Deselect</button>
        <button class="btn-primary" id="scanBtn" onclick="scan()">Scan</button>
      </div>
    </div>
    <div id="albumsArea">
      <p style="font-size:13px;color:rgba(255,255,255,0.3)">Click "Scan" to find albums</p>
    </div>
    <div id="skippedArea" class="hidden" style="margin-top:12px">
      <details>
        <summary style="font-size:12px;color:rgba(255,255,255,0.25);cursor:pointer">Skipped folders</summary>
        <div id="skippedList" style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.2)"></div>
      </details>
    </div>
  </div>

  <!-- Upload -->
  <div class="card" id="uploadCard" class="hidden">
    <div class="row" style="align-items:center;margin-bottom:12px">
      <h2 style="margin:0" id="uploadTitle">Upload</h2>
      <div class="shrink">
        <label style="display:inline;margin:0;cursor:pointer"><input type="checkbox" id="forceUpload" /> <span style="font-size:12px;color:rgba(255,255,255,0.4)">Force re-upload</span></label>
        <button class="btn-primary" id="uploadBtn" onclick="startUpload()" style="margin-left:12px">Upload</button>
      </div>
    </div>
    <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
    <div class="stats" id="statsBar">
      <span>Uploaded: <b id="statUp">0</b></span>
      <span>Skipped: <b id="statSkip">0</b></span>
      <span>Failed: <b id="statFail">0</b></span>
      <span>ETA: <b id="statEta">--</b></span>
    </div>
    <div class="log" id="log"></div>
  </div>
</div>

<script>
const params = new URLSearchParams(window.location.search);
const tokenFromQuery = params.get('t');
if (tokenFromQuery) {
  sessionStorage.setItem('uploader_token', tokenFromQuery);
  window.history.replaceState(null, '', window.location.pathname);
}
const UPLOADER_TOKEN = sessionStorage.getItem('uploader_token') || '';
function apiFetch(url, options = {}) {
  if (!UPLOADER_TOKEN) throw new Error('Uploader session is missing');
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Uploader-Token': UPLOADER_TOKEN,
    },
  });
}
let albums = [];
let scanData = null;
let rootDirs = [''];
let browsingIndex = 0;

function renderRootDirs() {
  const container = document.getElementById('rootDirList');
  let html = '';
  rootDirs.forEach((d, i) => {
    html += '<div class="row" style="margin-bottom:6px">';
    html += '<input type="text" value="'+esc(d)+'" oninput="rootDirs['+i+']=this.value" style="font-size:12px" />';
    html += '<button class="btn-secondary shrink" onclick="openBrowser('+i+')">Browse</button>';
    if (rootDirs.length > 1) {
      html += '<button class="btn-secondary shrink" onclick="removeRootDir('+i+')" style="color:rgba(248,113,113,0.7)">×</button>';
    }
    html += '</div>';
  });
  container.innerHTML = html;
}

function addRootDir() {
  rootDirs.push('');
  renderRootDirs();
}

function removeRootDir(i) {
  rootDirs.splice(i, 1);
  renderRootDirs();
}

async function loadConfig() {
  const r = await apiFetch('/api/config').then(r => r.json());
  rootDirs = [r.photosRootDir];
  renderRootDirs();
  document.getElementById('concurrency').value = r.concurrency;
}

async function saveConfig() {
  const concurrency = parseInt(document.getElementById('concurrency').value) || 4;
  await apiFetch('/api/config', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ photosRootDir: rootDirs[0] || '', concurrency }) });
  toast('Settings saved');
}

// Browser
let browserOpen = false;
function openBrowser(index) {
  browsingIndex = index;
  browserOpen = true;
  document.getElementById('browserPanel').classList.remove('hidden');
  browse(rootDirs[index] || '');
}

function toggleBrowser() {
  browserOpen = !browserOpen;
  document.getElementById('browserPanel').classList.toggle('hidden', !browserOpen);
  if (browserOpen) browse(rootDirs[browsingIndex] || '');
}

async function browse(dir) {
  try {
    const r = await apiFetch('/api/browse', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ dir }) }).then(r => r.json());
    if (r.error) { toast(r.error, true); return; }
    let html = '';
    if (r.parent) html += '<div class="browser-item browser-parent" onclick="browse(\\''+esc(r.parent)+'\\')">.. (parent)</div>';
    for (const f of r.folders) {
      html += '<div class="browser-item'+(f.isAlbum?' album':'')+'" onclick="pickFolder(\\''+esc(f.path)+'\\')">'+icon(f.isAlbum)+' '+esc(f.name)+'</div>';
    }
    document.getElementById('browser').innerHTML = html || '<div style="padding:12px;color:rgba(255,255,255,0.2)">Empty</div>';
  } catch(e) { toast(e.message, true); }
}

function pickFolder(p) {
  rootDirs[browsingIndex] = p;
  renderRootDirs();
  browse(p);
}

function icon(isAlbum) { return isAlbum ? '<span style="color:rgba(74,222,128,0.6)">&#x1F4C1;</span>' : '&#x1F4C2;'; }
function esc(s) { return s.replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'").replace(/</g,'&lt;'); }

// Scan
async function scan() {
  const btn = document.getElementById('scanBtn');
  btn.disabled = true; btn.textContent = 'Scanning...';
  try {
    const dirs = rootDirs.filter(d => d.trim());
    if (!dirs.length) { toast('請先設定資料夾路徑', true); btn.disabled = false; btn.textContent = 'Scan'; return; }
    const r = await apiFetch('/api/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ rootDirs: dirs }) }).then(r => r.json());
    scanData = r.data;
    albums = scanData.albums.map(a => ({ ...a, selected: true }));
    renderAlbums();
    if (scanData.skippedFolders && scanData.skippedFolders.length > 0) {
      document.getElementById('skippedArea').classList.remove('hidden');
      document.getElementById('skippedList').innerHTML = scanData.skippedFolders.map(s => '<div>'+esc(s.name)+' — '+esc(s.reason)+'</div>').join('');
    }
  } catch(e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = 'Scan';
}

function renderAlbums() {
  if (!albums.length) { document.getElementById('albumsArea').innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:13px">No albums found</p>'; return; }
  const total = albums.reduce((s,a) => s + a.photoCount, 0);
  const totalSize = (albums.reduce((s,a) => s + a.totalSize, 0) / 1024 / 1024).toFixed(0);
  let html = '<p style="font-size:12px;color:rgba(255,255,255,0.3);margin-bottom:8px">'+albums.length+' albums, '+total+' photos, '+totalSize+' MB</p>';
  html += '<table><thead><tr><th style="width:30px"></th><th>Folder</th><th>Date</th><th>Title</th><th class="text-right">Photos</th></tr></thead><tbody>';
  albums.forEach((a, i) => {
    html += '<tr><td><input type="checkbox" '+(a.selected?'checked':'')+' onchange="albums['+i+'].selected=this.checked;updateUploadBtn()"></td>';
    html += '<td class="mono">'+esc(a.folderName)+'</td>';
    html += '<td class="mono">'+a.date+'</td>';
    html += '<td>'+esc(a.title)+'</td>';
    html += '<td class="text-right mono">'+a.photoCount+'</td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById('albumsArea').innerHTML = html;
  updateUploadBtn();
}

function toggleAll(v) { albums.forEach(a => a.selected = v); renderAlbums(); }

function updateUploadBtn() {
  const sel = albums.filter(a => a.selected);
  const total = sel.reduce((s,a) => s + a.photoCount, 0);
  document.getElementById('uploadBtn').textContent = 'Upload '+sel.length+' albums ('+total+' photos)';
}

// Upload
async function startUpload() {
  const selected = albums.filter(a => a.selected).map(a => a.slug);
  if (!selected.length) { toast('Please select at least one album', true); return; }

  const btn = document.getElementById('uploadBtn');
  btn.disabled = true;
  const log = document.getElementById('log');
  log.innerHTML = '';

  const dirs = rootDirs.filter(d => d.trim());
  const force = document.getElementById('forceUpload').checked;

  const res = await apiFetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootDirs: dirs, albums: selected, force }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\\n');
    buffer = lines.pop();

    let eventName = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) eventName = line.slice(7).trim();
      else if (line.startsWith('data: ') && eventName) {
        try { handleSSE(eventName, JSON.parse(line.slice(6))); } catch {}
        eventName = '';
      }
    }
  }
  btn.disabled = false;
}

function handleSSE(event, data) {
  const log = document.getElementById('log');
  if (event === 'album_start') {
    log.innerHTML += '<div class="log-info">\\n━━ [' + (data.index+1) + '/' + data.total + '] ' + esc(data.name) + ' (' + data.photoCount + ' photos) ━━</div>';
  } else if (event === 'photo') {
    const id = 'photo-' + data.global;
    let el = document.getElementById(id);
    const progress = '[' + data.global + '/' + data.totalPhotos + ']';
    const etaMin = Math.floor(data.eta / 60);
    const etaSec = data.eta % 60;
    const etaStr = data.eta > 0 ? ' | ETA ' + (etaMin > 0 ? etaMin + 'm' : '') + etaSec + 's' : '';

    let cls = 'log-info', text = '';
    if (data.status === 'done') { cls = 'log-ok'; text = '  \\u2713 ' + progress + ' ' + data.fileName + ' — ' + data.elapsed + 's' + etaStr; }
    else if (data.status === 'skipped') { cls = 'log-skip'; text = '  \\u2192 ' + progress + ' ' + data.fileName + ' — skipped' + etaStr; }
    else if (data.status === 'error') { cls = 'log-err'; text = '  \\u2717 ' + progress + ' ' + data.fileName + ' — ' + data.error + etaStr; }
    else { text = '  \\u2026 ' + progress + ' ' + data.fileName + ' — ' + data.status + '...' + etaStr; }

    if (!el) { el = document.createElement('div'); el.id = id; log.appendChild(el); }
    el.className = cls;
    el.textContent = text;

    // Auto scroll
    log.scrollTop = log.scrollHeight;

    // Update stats
    document.getElementById('statUp').textContent = data.uploaded;
    document.getElementById('statSkip').textContent = data.skipped;
    document.getElementById('statFail').textContent = data.failed;
    const etaDisp = data.eta > 60 ? Math.floor(data.eta/60) + 'm ' + (data.eta%60) + 's' : data.eta + 's';
    document.getElementById('statEta').textContent = data.eta > 0 ? etaDisp : '--';

    // Progress bar
    const pct = data.totalPhotos > 0 ? (data.global / data.totalPhotos * 100) : 0;
    document.getElementById('progressFill').style.width = pct + '%';

  } else if (event === 'complete') {
    log.innerHTML += '<div class="log-info">\\n━━ Complete: ' + data.uploaded + ' uploaded, ' + data.skipped + ' skipped, ' + data.failed + ' failed (' + data.elapsed + 's) ━━</div>';
    document.getElementById('statEta').textContent = 'Done';
    document.getElementById('progressFill').style.width = '100%';
    toast('Upload complete! ' + data.uploaded + ' photos uploaded');
  } else if (event === 'error') {
    log.innerHTML += '<div class="log-err">Error: ' + esc(data.message) + '</div>';
    toast(data.message, true);
  }
}

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast ' + (err ? 'toast-err' : 'toast-ok');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

loadConfig();
</script>
</body>
</html>`;
