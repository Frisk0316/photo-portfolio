# Photo Portfolio

A self-hosted photography portfolio — Next.js frontend, Express backend, Cloudflare R2 storage, PostgreSQL.

## Quick start (local dev)

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Install all packages
npm install   # root workspace install
# I want to use pnpm

# 3. Backend
cd backend
cp ../.env.example .env   # fill in values
npm run dev               # starts on :4000

# 4. Run migrations (in another terminal)
cd backend && npm run migrate

# 5. Frontend
cd frontend
cp .env.local.example .env.local
npm run dev               # starts on :3000

# 6. Upload photos (CLI)
cd uploader
cp ../.env.example .env   # set PHOTOS_ROOT_DIR
node index.js --dry-run   # preview
node index.js             # upload
```

## Structure

```
photo-portfolio/
├── frontend/    Next.js app (public gallery + admin)
├── backend/     Express API (auth, albums, photos, upload)
├── uploader/    CLI batch upload tool
└── shared/      Shared types
```

## Deployment

- **Frontend** → Vercel (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_R2_PUBLIC_URL`)
- **Backend** → Railway (all env vars from `.env.example`)
- **Database** → Neon (set `DATABASE_URL`)
- **Storage** → Cloudflare R2 (set R2_* vars)
