# Backstop backend (API + indexer + hedger + resolver). The web app deploys separately to Vercel.
FROM node:24-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --prod --filter @backstop/backend

COPY backend backend
WORKDIR /app/backend

# Mount a persistent volume at /data so the policy index survives restarts.
ENV NODE_ENV=production DB_PATH=/data/backstop.db PORT=8787
EXPOSE 8787
CMD ["pnpm", "start"]
