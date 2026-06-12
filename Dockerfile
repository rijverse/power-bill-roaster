# Build with bun (fast installs), but run on Node: the DESCO client relies on
# Node's https.Agent with rejectUnauthorized=false, which we don't trust to
# behave identically under the Bun runtime.
FROM oven/bun:1-alpine AS build
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
EXPOSE 3000
CMD ["node", "dist/index.js"]
