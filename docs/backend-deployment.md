# Backend Deployment

This backend was previously configured for Railway. It can now deploy to Render or Zeabur from the same repository.

## Recommended Free Option

Use Render first if you want a simple free backend URL and built-in Blueprint support. Zeabur is also fine for testing, but its free plan sleeps on idle and may have tighter project/service limits.

Both platforms have an ephemeral filesystem on free tiers, so keep PostgreSQL on Neon and image files on Cloudflare R2.

## Required Environment Variables

Set these in the target platform dashboard:

```env
DATABASE_URL=
JWT_SECRET=
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=
ALLOWED_ORIGINS=https://your-frontend-domain.com,http://localhost:3000

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=
R2_WORKER_URL=
R2_WORKER_SECRET=

THUMBNAIL_HEIGHT=400
MEDIUM_WIDTH=1600
WEBP_QUALITY=82
JPEG_QUALITY=85
NODE_ENV=production
```

Optional contact-form email variables:

```env
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
NOTIFY_EMAIL=
```

Render free web services currently block outbound SMTP ports 25, 465, and 587. If you deploy on Render free and need contact email notifications, use an email provider/port that Render allows, or leave SMTP unset and read submissions from the admin contact page.

## Generate `ADMIN_PASSWORD_HASH`

From the backend folder:

```bash
pnpm install
pnpm hash-password "your-admin-password"
```

Paste the printed bcrypt value into `ADMIN_PASSWORD_HASH`.

## Render

1. Push this repo to GitHub.
2. In Render, create a new Blueprint from this repo. Render reads `render.yaml`.
3. Fill the secret env vars marked `sync: false`.
4. Deploy and check `https://your-service.onrender.com/health`.
5. Update the frontend/Vercel env var:

```env
NEXT_PUBLIC_API_URL=https://your-service.onrender.com
```

If creating the service manually instead of using the Blueprint:

```text
Root Directory: backend
Build Command: corepack enable && pnpm install --prod --frozen-lockfile
Start Command: pnpm start:deploy
Health Check Path: /health
```

## Zeabur

1. Create a new project and import the GitHub repo.
2. Zeabur reads `zbpack.json` and deploys the `backend` folder.
3. Add the required environment variables in the service settings.
4. Deploy and check `https://your-zeabur-domain/health`.
5. Update the frontend/Vercel env var:

```env
NEXT_PUBLIC_API_URL=https://your-zeabur-domain
```

If Zeabur asks for commands manually:

```text
App directory: backend
Build Command: corepack enable && pnpm install --prod --frozen-lockfile
Start Command: pnpm start:deploy
```

## After Switching

Set `ALLOWED_ORIGINS` on the backend to your frontend domains, for example:

```env
ALLOWED_ORIGINS=https://ospreay-photo.com,https://www.ospreay-photo.com,http://localhost:3000
```

Then redeploy the backend and frontend.
