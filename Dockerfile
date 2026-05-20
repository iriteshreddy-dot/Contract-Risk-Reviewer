# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the Contract Risk Reviewer.
# Build stage installs better-sqlite3 (and any other native deps) with the
# toolchain present, then the runtime stage copies just the install output.
#

# ─── 1. Build stage ───────────────────────────────────────
FROM node:20-bookworm-slim AS build

WORKDIR /app

# Build tools for any native modules whose prebuilds don't match Fly's CPU.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── 2. Runtime stage ─────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/reviews.db

# Install only what runtime needs (better-sqlite3 prebuilds use libstdc++,
# which is already in node:20-bookworm-slim).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

# Bring in the prebuilt node_modules from the build stage.
COPY --from=build /app/node_modules ./node_modules

# Application source. .dockerignore keeps the build context clean.
COPY package.json package-lock.json ./
COPY src        ./src
COPY mcp-servers ./mcp-servers
COPY public     ./public
COPY .claude    ./.claude

EXPOSE 8080

# tini reaps zombie MCP-server child processes cleanly on SIGTERM.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
