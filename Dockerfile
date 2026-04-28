FROM node:20-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY backend/package.json backend/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY backend ./

ENV NODE_ENV=production

EXPOSE 4000

CMD ["pnpm", "start:deploy"]
