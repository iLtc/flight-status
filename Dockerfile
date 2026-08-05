FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
# tzdata: belt-and-braces for America/Los_Angeles handling in the runtime image.
RUN apk add --no-cache tzdata
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
# wget ships with busybox — no extra package needed. Probe /api/health only:
# probing /api/flights would pull 14.3 MB from flysfo on every check.
# 127.0.0.1, not localhost: busybox wget resolves localhost to ::1 without
# IPv4 fallback, but HOSTNAME=0.0.0.0 makes Node listen on IPv4 only.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Run as the non-root `node` user the base image ships. The standalone build
# output above was COPYed in while root (default build-stage user), but with
# default umask that leaves files/dirs world-readable/executable (644/755),
# which is all `node` needs to read and run them — no --chown required.
USER node
CMD ["node", "server.js"]
