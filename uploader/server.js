#!/usr/bin/env node
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanPhotosDirectory, printManifest, parseAlbumFolder } from './scanner.js';
import { processImage, classifyAspectRatio } from './processor.js';
import { uploadImageVariants } from './uploader.js';
import { initializeSchema, findOrCreateAlbum, insertPhoto, updateAlbumStats, getExistingPhotos, closeDb } from './db.js';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

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
      content = content.replace(/^PHOTOS_ROOT_DIR=.*/m, `PHOTOS_ROOT_DIR=${photosRootDir}`);
      config.photosRootDir = photosRootDir;
    }
    if (concurrency !== undefined) {
      content = content.replace(/^UPLOAD_CONCURRENCY=.*/m, `UPLOAD_CONCURRENCY=${concurrency}`);
      config.concurrency = concurrency;
    }
    await fs.writeFile(envPath, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Browse directory
app.post('/api/browse', async (req, res) => {
  try {
    const { dir } = req.body;
    const target = dir || config.photosRootDir;
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
    res.json({ current: target, parent: parent !== target ? parent : null, folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan
app.post('/api/scan', async (req, res) => {
  try {
    const rootDir = req.body.rootDir || config.photosRootDir;
    const manifest = await scanPhotosDirectory(rootDir);
    res.json({ data: manifest });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const manifest = await scanPhotosDirectory(req.body.rootDir || config.photosRootDir);
    const albumsToUpload = selectedSlugs
      ? manifest.albums.filter(a => selectedSlugs.includes(a.slug))
      : manifest.albums;

    let totalPhotos = albumsToUpload.reduce((s, a) => s + a.photoCount, 0);
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
            fileSize: processed.original.size, sortOrder: photo.sortOrder,
          });

          uploaded++;
          send('photo', { albumIndex: ai, photoIndex: pi, global: globalPhoto, totalPhotos, fileName: photo.fileName, status: 'done', uploaded, skipped, failed, elapsed: ((Date.now() - startTime) / 1000).toFixed(0), eta });
        } catch (err) {
          failed++;
          send('photo', { albumIndex: ai, photoIndex: pi, global: globalPhoto, totalPhotos, fileName: photo.fileName, status: 'error', error: err.message, uploaded, skipped, failed, elapsed, eta });
        }
      }

      await updateAlbumStats(albumId);
      send('album_done', { index: ai, name: album.folderName });
    }

    send('complete', { uploaded, skipped, failed, elapsed: ((Date.now() - startTime) / 1000).toFixed(1) });
  } catch (err) {
    send('error', { message: err.message });
  }

  res.end();
});

// ── Serve GUI ──
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(HTML);
});

const PORT = 4100;
app.listen(PORT, () => {
  console.log(`\n  Photo Uploader GUI`);
  console.log(`  http://localhost:${PORT}\n`);
});

// ── Embedded HTML ──
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
    <div class="row" style="margin-bottom:12px">
      <div>
        <label>Photos Root Directory</label>
        <div class="row">
          <input type="text" id="rootDir" />
          <button class="btn-secondary shrink" onclick="toggleBrowser()">Browse</button>
          <button class="btn-secondary shrink" onclick="saveConfig()">Save</button>
        </div>
      </div>
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
let albums = [];
let scanData = null;

async function loadConfig() {
  const r = await fetch('/api/config').then(r => r.json());
  document.getElementById('rootDir').value = r.photosRootDir;
  document.getElementById('concurrency').value = r.concurrency;
}

async function saveConfig() {
  const rootDir = document.getElementById('rootDir').value;
  const concurrency = parseInt(document.getElementById('concurrency').value) || 4;
  await fetch('/api/config', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ photosRootDir: rootDir, concurrency }) });
  toast('Settings saved');
}

// Browser
let browserOpen = false;
function toggleBrowser() {
  browserOpen = !browserOpen;
  document.getElementById('browserPanel').classList.toggle('hidden', !browserOpen);
  if (browserOpen) browse(document.getElementById('rootDir').value);
}

async function browse(dir) {
  try {
    const r = await fetch('/api/browse', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ dir }) }).then(r => r.json());
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
  document.getElementById('rootDir').value = p;
  browse(p);
}

function icon(isAlbum) { return isAlbum ? '<span style="color:rgba(74,222,128,0.6)">&#x1F4C1;</span>' : '&#x1F4C2;'; }
function esc(s) { return s.replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'").replace(/</g,'&lt;'); }

// Scan
async function scan() {
  const btn = document.getElementById('scanBtn');
  btn.disabled = true; btn.textContent = 'Scanning...';
  try {
    const rootDir = document.getElementById('rootDir').value;
    const r = await fetch('/api/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ rootDir }) }).then(r => r.json());
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
    html += '<tr><td><input type="checkbox" '+(a.selected?'checked':'')+' onchange="albums['+i+'].selected=this.checked"></td>';
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

  const rootDir = document.getElementById('rootDir').value;
  const force = document.getElementById('forceUpload').checked;

  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootDir, albums: selected, force }),
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
