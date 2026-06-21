# syntax=docker/dockerfile:1.7
#
# Production image for the @noted/api service.
#
# Multi-stage, multi-arch. `node:22-alpine` and `oven/bun` are multi-arch
# manifests, so this image builds natively on AWS Graviton (linux/arm64) as well
# as x86_64 — Docker selects the right base layer per target platform.
#
# Build context is the monorepo ROOT (bun workspaces):
#   docker build -t noted-api:test .
#
# Pipeline:
#   build: bun install --frozen-lockfile (incl. devDependencies for the build)
#          && bun run build:api               (esbuild bundle -> apps/api/dist/index.js)
#          && reinstall production-only deps
#   run:   node apps/api/dist/index.js

# ---------------------------------------------------------------------------
# Stage 1: builder — install the full dependency graph and bundle the API.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

# Toolchain for any dependency that needs a node-gyp fallback when a prebuilt
# binary is unavailable for the target arch. Confined to the builder stage so it
# never reaches the runtime image.
RUN apk add --no-cache python3 make g++ libc6-compat

# Bun is the package manager / script runner at build time; the runtime stays
# Node. The musl build from the matching alpine image works on amd64 and arm64.
COPY --from=oven/bun:1.3.14-alpine /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Install dependencies first for better layer caching. Copy only the manifests,
# the lockfile and the bun config (hoisted linker — required so the runtime
# image can resolve deps from the root node_modules; see the Bun-1.3 isolated
# linker gotcha) so this layer is reused unless dependencies change. The app
# workspace's package.json is included (its source is excluded by .dockerignore)
# so the bun workspace graph stays valid.
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/app/package.json ./apps/app/package.json

# Deterministic install from the lockfile, including devDependencies (esbuild,
# TypeScript) required to bundle the API.
RUN bun install --frozen-lockfile

# Copy the source needed to build the API.
COPY apps/api ./apps/api

# Bundle the API with esbuild -> apps/api/dist/index.js (externalizes
# node_modules, inlines @oxyhq/*; see apps/api/build.ts).
RUN bun run build:api

# Fail fast if the expected entry point was not emitted.
RUN test -f apps/api/dist/index.js \
 || (echo "ERROR: apps/api/dist/index.js was not produced by the build" && exit 1)

# Strip devDependencies so only production modules are carried into the runtime
# image (bun has no `prune`; a clean production install from the same lockfile is
# the deterministic equivalent).
RUN rm -rf node_modules \
 && bun install --frozen-lockfile --production

# ---------------------------------------------------------------------------
# Stage 2: runner — minimal runtime with production deps and the bundle.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

ENV NODE_ENV=production \
    PORT=3001

# libc6-compat: glibc shim some prebuilt native binaries expect on Alpine/musl.
# dumb-init: proper PID 1 so SIGTERM/SIGINT reach Node for graceful shutdown.
RUN apk add --no-cache libc6-compat dumb-init

WORKDIR /app

# Run as the unprivileged `node` user provided by the base image.
USER node

# Bring over the pruned (production-only) dependency tree and the workspace
# manifests so Node's workspace resolution stays valid.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/package.json

# The bundled API.
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist

EXPOSE 3001

# Container-level health check hitting the app's /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3001,path:'/health',timeout:4000},r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/index.js"]
