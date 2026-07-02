# Build with bun (fast installs); the production stage below runs on the official
# node image, which is the runtime the app targets (start = node dist/index.js).
# Pinned to match bun.lock: a floating tag (1 / latest) pulls a newer bun that
# re-resolves the frozen lockfile and fails the build. Bump this together with
# the lockfile, never on its own.
FROM oven/bun:1.2.23-alpine AS build
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
CMD ["node", "dist/index.js"]
