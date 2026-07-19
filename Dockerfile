# Build with bun (fast installs); the production stage below runs on the official
# node image, which is the runtime the app targets (start = node dist/index.js).
# Pinned to match bun.lock: a floating tag (1 / latest) pulls a newer bun that
# re-resolves the frozen lockfile and fails the build. Keep BUN_VERSION in sync
# with .bun-version (the source the workflows read); bump both with the lockfile.
ARG BUN_VERSION=1.2.23
FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN bun run build && rm -rf node_modules && bun install --production --frozen-lockfile

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# drop root: the runtime only needs to read these files and bind a high port
USER node
EXPOSE 3000
# node, not curl - the runtime image has no curl. This gives `docker ps` and any
# orchestrator visibility into /health; it is NOT the restart mechanism, since
# `restart: unless-stopped` acts on exit rather than on unhealthy. The in-process
# watchdog (src/index.ts) is what actually exits a wedged process.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
