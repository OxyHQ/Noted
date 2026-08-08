# syntax=docker/dockerfile:1.7
#
# Production image for the @noted/backend service.
#
# Multi-stage, multi-arch. `node:22-alpine` and `oven/bun` are multi-arch
# manifests, so this image builds natively on AWS Graviton (linux/arm64) as well
# as x86_64 — Docker selects the right base layer per target platform.
#
# Build context is the monorepo ROOT (bun workspaces):
#   docker build -t noted-backend:test .
#
# Pipeline:
#   build: bun install --frozen-lockfile (incl. devDependencies for the build)
#          && bun run build:backend           (builds @noted/shared-types, then
#                                               esbuild bundle -> packages/backend/dist/index.js;
#                                               shared-types is INLINED into the bundle)
#          && reinstall production-only deps
#   run:   node packages/backend/dist/index.js

# ---------------------------------------------------------------------------
# Stage 1: builder — install the full dependency graph and bundle the API.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

# Bun is the package manager / script runner at build time; the runtime stays
# Node. The musl build from the matching alpine image works on amd64 and arm64.
COPY --from=oven/bun:1.3.14-alpine /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Install dependencies first for better layer caching. Copy only the manifests,
# the lockfile and the bun config (hoisted linker — required so the runtime
# image can resolve deps from the root node_modules; see the Bun-1.3 isolated
# linker gotcha) so this layer is reused unless dependencies change. Every
# workspace's package.json is included (their source is excluded by
# .dockerignore) so the bun workspace graph stays valid — including
# @noted/shared-types, a workspace dependency of the backend.
COPY package.json bun.lock bunfig.toml ./
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json

# Deterministic install from the lockfile, including devDependencies (esbuild,
# TypeScript) required to bundle the backend.
#
# --ignore-scripts: skip dependency lifecycle scripts. There is no first-party
# postinstall to skip; the only lifecycle scripts in this graph are the native
# install scripts of `bufferutil` / `utf-8-validate` (OPTIONAL C++ speedups for
# `ws`, pulled in transitively by socket.io) and `msgpackr-extract` (an OPTIONAL
# accelerator for msgpackr, pulled in by bullmq). None ship a linux/arm64
# prebuild, so running them forces a from-source `node-gyp` compile on Graviton
# that also downloads Node headers over the network at build time — a fragile
# step that breaks the arm64 image build. Each consumer transparently falls back
# to its pure-JS path when the native addon is absent, so skipping the scripts is
# behaviour-preserving and matches the sibling Oxy backends (Mention, Allo).
RUN bun install --frozen-lockfile --ignore-scripts

# Copy the source needed to build the backend. @noted/shared-types is a build
# dependency: `build:backend` runs `build:types` first (tsc -> dist) and esbuild
# then INLINES the compiled shared types into the backend bundle, so the runtime
# image never needs shared-types' dist.
COPY packages/shared-types ./packages/shared-types
COPY packages/backend ./packages/backend

# Build @noted/shared-types (tsc), then bundle the backend with esbuild ->
# packages/backend/dist/index.js (externalizes node_modules, inlines @oxyhq/* +
# @noted/*; see packages/backend/build.ts). `build:backend` chains both.
RUN bun run build:backend

# Fail fast if the expected entry point was not emitted.
RUN test -f packages/backend/dist/index.js \
 || (echo "ERROR: packages/backend/dist/index.js was not produced by the build" && exit 1)
# The migrator ships in the same image as the server it migrates for. Asserted
# here because its absence has no symptom until a deploy: the image builds, the
# service starts, and only the migration task fails — after the rollout has begun.
RUN test -f packages/backend/dist/migrate.js \
 || (echo "ERROR: packages/backend/dist/migrate.js was not produced by the build" && exit 1)

# Strip devDependencies so only production modules are carried into the runtime
# image (bun has no `prune`; a clean production install from the same lockfile is
# the deterministic equivalent). --ignore-scripts for the same reason as the
# install above (optional ws native optimizations, no first-party postinstall).
RUN rm -rf node_modules \
 && bun install --frozen-lockfile --production --ignore-scripts

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
COPY --from=builder --chown=node:node /app/packages/backend/package.json ./packages/backend/package.json

# The bundled backend (shared-types is inlined into this bundle, so its dist is
# intentionally NOT carried into the runtime image).
COPY --from=builder --chown=node:node /app/packages/backend/dist ./packages/backend/dist

# The SQL migrations, beside packages/backend/package.json because that is what
# `src/db/migrationsFolder.ts` walks up to find.
#
# Needed by BOTH the one-shot migration task and every serving task: readiness
# reads this folder's journal to decide whether a task may take traffic, and
# `readJournal` runs at module load — so without this the container does not
# merely fail its probe, it fails to boot.
COPY --from=builder --chown=node:node /app/packages/backend/drizzle ./packages/backend/drizzle

EXPOSE 3001

# Container-level health check hitting the app's /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3001,path:'/health',timeout:4000},r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/backend/dist/index.js"]
