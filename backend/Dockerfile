FROM node:20-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY . .

ENV NODE_ENV=production

EXPOSE 4000

CMD ["pnpm", "start:deploy"]
