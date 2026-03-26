# Photo Portfolio

A self-hosted photography portfolio — Next.js 14 frontend, Express backend, Cloudflare R2 storage, PostgreSQL.

## Quick start (local dev)

```bash
# 1. Install all packages
pnpm install

# 2. Backend
cd backend
cp ../.env.example .env   # fill in values
pnpm dev                  # starts on :4000

# 3. Run migrations (in another terminal)
cd backend && pnpm migrate

# 4. Frontend
cd frontend
cp .env.local.example .env.local
pnpm dev                  # starts on :3000
```

## Upload photos

### CLI

```bash
cd uploader
cp ../.env.example .env   # set PHOTOS_ROOT_DIR, R2 credentials
node index.js --dry-run   # preview what will be uploaded
node index.js             # upload
```

- Scans `PHOTOS_ROOT_DIR` for album folders (format: `YYYYMMDD - Title`)
- Looks for edited JPGs inside subfolders named `調整後 JPG`, `調整後JPG`, `Edited JPG`, or `edited`
- Generates 4 variants per photo: original, thumbnail, medium, webp
- Computes BlurHash placeholders and extracts EXIF data
- Shows real-time per-photo progress with ETA

### GUI

```bash
cd uploader
pnpm gui                  # starts on :4100
```

Open <http://localhost:4100> — provides a web interface for:

- Editing upload settings (root directory, concurrency)
- Browsing and selecting album folders visually
- Scanning and uploading with real-time progress bar and ETA

## Structure

```
photo-portfolio/
├── frontend/    Next.js 14 app (public gallery + admin)
├── backend/     Express API (auth, albums, photos, upload)
├── uploader/    CLI + GUI batch upload tool
└── shared/      Shared types
```

## Features

- **Gallery** — responsive album grid with cover crop, BlurHash placeholders, sort by date
- **Lightbox** — zoom (scroll wheel 1x–4x), pan (drag), double-click toggle, keyboard navigation
- **EXIF panel** — press `i` in lightbox to view camera, lens, aperture, shutter, ISO
- **Slideshow** — press `Space` for auto-play (4s interval) with progress bar
- **Admin** — album CRUD, photo management, cover photo editor with crop/zoom
- **Toast notifications** — success/error feedback on save actions
- **Batch upload** — CLI with detailed logging or GUI with visual progress

## Deployment

- **Frontend** → Vercel (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_R2_PUBLIC_URL`)
- **Backend** → Railway (all env vars from `.env.example`)
- **Database** → Neon (set `DATABASE_URL`)
- **Storage** → Cloudflare R2 (set R2_* vars)
