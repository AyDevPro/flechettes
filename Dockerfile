# ── 1. Compilation du serveur TypeScript ────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /build
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY server/ ./server/
RUN cd server && npm run build

# ── 2. Image finale ─────────────────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production TZ=Europe/Paris
WORKDIR /app
RUN apk add --no-cache tzdata tini

COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /build/server/dist ./dist
COPY web/ ./web/

ENV WEB_DIR=/app/web PORT=3000 STATE_FILE=/data/game.json
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
