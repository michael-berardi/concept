# Concept — multi-stage build: web (React/Vite) -> server (Node 22 + TypeScript).
# Build from the repository root:  docker build -t concept .
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json ./

# ---------- web (React 19 + Vite) ----------
FROM base AS web
COPY web/package.json ./web/
RUN pnpm --filter @concept/web install --no-frozen-lockfile
COPY web/ ./web/
COPY server/ ./server/
RUN pnpm --filter @concept/web build

# ---------- server (TypeScript -> dist) ----------
FROM base AS server
COPY server/package.json ./server/
RUN pnpm --filter @concept/server install --no-frozen-lockfile
COPY server/ ./server/
RUN pnpm --filter @concept/server build \
  # prune dev dependencies for the runtime image
  && cd server && pnpm install --no-frozen-lockfile --prod

# ---------- runtime ----------
FROM node:22-alpine AS runtime
# git is required for vault sync; tini reaps zombies from git subprocesses
RUN apk add --no-cache git tini curl
WORKDIR /app
ENV NODE_ENV=production \
    CONCEPT_DATA_DIR=/data \
    PORT=8787
COPY --from=server /app/server/package.json ./server/package.json
COPY --from=server /app/server/node_modules ./server/node_modules
COPY --from=server /app/server/dist ./server/dist
COPY --from=web /app/server/public ./server/public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
WORKDIR /app/server
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8787/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
