# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
#
# Every image this file pulls (the `# syntax` frontend on line 1, both base images
# and the Bun binary below) is pinned by its multi-arch INDEX digest; the tag
# beside it is for readers. The digest is what the build uses, so a re-pushed tag
# changes nothing. Bumping one means resolving the new tag's index digest,
# confirming it lists linux/arm64, and an owner re-review and re-pin of
# .github/scripts/reviewed-images.json (`reviewed-image.py pin`).
#
# Production image for the @noted/backend service.
#
# Multi-stage, multi-arch. `node:24.20-alpine` and `oven/bun` are multi-arch
# manifests, so this image builds natively on AWS Graviton (linux/arm64) as well
# as x86_64 — Docker selects the right base layer per target platform.
#
# The API RUNS ON BUN. The runner stage is `oven/bun:1.4.3-alpine`: the same Bun
# that installs and bundles below, and the same musl libc the production
# dependency tree is installed against. The API ran on Node until 2026-10; Bun
# serves the same esbuild bundle (ESM, platform=node) unchanged. Measured on the
# built dist against a local Postgres 17 and Redis: both migrator phases apply,
# /health, /health/ready and the socket.io handshake answer as on Node, the
# BullMQ reminder worker starts and sweeps, SIGTERM runs the graceful shutdown
# to exit 0, and idle RSS was ~105 MB under Bun against ~285 MB under Node.
#
# Every one-shot that overrides the CMD (the migrator and the capability-catalog
# registration in .github/workflows/deploy-aws.yml) names `bun` too. Rolling
# back to Node is reverting the change that made this switch: it moves this
# stage and those commands together, and they must stay together.
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
#   run:   bun packages/backend/dist/index.js     (oven/bun alpine, Bun as the runtime)

# ---------------------------------------------------------------------------
# Stage 1: builder — install the full dependency graph and bundle the API.
# ---------------------------------------------------------------------------
FROM node:24.20-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS builder

# Bun is the package manager / script runner at build time (and, from the runner
# stage below, the runtime). The musl build from the matching alpine image works
# on amd64 and arm64; it is the exact binary the runner stage ships.
COPY --from=oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 /usr/local/bin/bun /usr/local/bin/bun

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
# --ignore-scripts: skip dependency lifecycle scripts. No first-party package in
# this repo declares one, so none of ours is skipped.
#
# SEVEN dependencies declare an install/postinstall script, but only two are the
# reason for this flag. `bufferutil` and `utf-8-validate` are OPTIONAL C++
# speedups for `ws` (transitive via socket.io) whose tarballs carry linux-x64,
# darwin and win32 prebuilds but NO linux-arm64 — so `node-gyp-build` falls back
# to a from-source `node-gyp` compile that also downloads Node headers over the
# network, the fragile step that breaks the arm64 image build. `ws` uses its
# pure-JS path when the addon is absent, so skipping them is behaviour-preserving.
#
# The other five are already arm64-safe and are skipped only as a side effect:
# `esbuild`, `@swc/core`, `msgpackr-extract` and `@parcel/watcher` each load a
# PREBUILT binary from a per-platform optionalDependency that bun installs
# directly (`@esbuild/linux-arm64`, `@swc/core-linux-arm64-gnu`,
# `@msgpackr-extract/msgpackr-extract-linux-arm64` and
# `@parcel/watcher-linux-arm64-glibc` are all in bun.lock), so their scripts only
# locate a binary that is already present; `msw` is test-only (a vitest peer) and
# its postinstall already swallows its own errors. Note that `msgpackr-extract`
# is therefore NOT one of the offenders — it resolves through
# `node-gyp-build-optional-packages` and never needs a compile on Graviton.
#
# Matches the sibling Oxy backends (Mention, Allo), and the arm64 CI install in
# .github/workflows/deploy-aws.yml skips scripts for the same reason.
RUN bun install --frozen-lockfile --ignore-scripts

# Copy the source needed to build the backend. @noted/shared-types is a build
# dependency: `build:backend` runs `build:types` first (tsc -> dist) and esbuild
# then INLINES the compiled shared types into the backend bundle, so the runtime
# image never needs shared-types' dist.
COPY packages/shared-types ./packages/shared-types
COPY packages/backend ./packages/backend

# Build @noted/shared-types (tsc), then bundle the backend with esbuild ->
# packages/backend/dist/index.js (externalizes node_modules, inlines @oxy.so/* +
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
RUN test -f packages/backend/dist/register-capability-catalog.js \
 || (echo "ERROR: packages/backend/dist/register-capability-catalog.js was not produced by the build" && exit 1)

# Strip devDependencies so only production modules are carried into the runtime
# image (bun has no `prune`; a clean production install from the same lockfile is
# the deterministic equivalent). --ignore-scripts for the same reason as the
# install above (optional ws native optimizations, no first-party postinstall).
RUN rm -rf node_modules \
 && bun install --frozen-lockfile --production --ignore-scripts

# ---------------------------------------------------------------------------
# Stage 2: runner — minimal runtime with production deps and the bundle.
# ---------------------------------------------------------------------------
# The tag is the root package.json `packageManager` pin, like the builder's
# COPY --from above; a Bun bump moves all three together, digests included.
FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS runner

ENV NODE_ENV=production \
    PORT=3001

# libc6-compat: glibc shim some prebuilt native binaries expect on Alpine/musl.
# dumb-init: PID 1 that forwards SIGTERM/SIGINT to Bun (which registers the
# graceful-shutdown handler) and reaps children, exactly as it did for Node.
RUN apk add --no-cache libc6-compat dumb-init

WORKDIR /app

# Run as the unprivileged `bun` user provided by the base image: uid/gid 1000,
# the same ids as the Node image's `node` user it replaces.
USER bun

# Bring over the pruned (production-only) dependency tree and the workspace
# manifests so the runtime's workspace resolution stays valid.
COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/package.json ./package.json
COPY --from=builder --chown=bun:bun /app/packages/backend/package.json ./packages/backend/package.json

# The bundled backend (shared-types is inlined into this bundle, so its dist is
# intentionally NOT carried into the runtime image).
COPY --from=builder --chown=bun:bun /app/packages/backend/dist ./packages/backend/dist

# The SQL migrations, beside packages/backend/package.json because that is what
# `src/db/migrationsFolder.ts` walks up to find.
#
# Needed by BOTH the one-shot migration task and every serving task: readiness
# reads this folder's journal to decide whether a task may take traffic, and
# `readJournal` runs at module load — so without this the container does not
# merely fail its probe, it fails to boot.
COPY --from=builder --chown=bun:bun /app/packages/backend/drizzle ./packages/backend/drizzle

EXPOSE 3001

# Container-level health check hitting the app's /health endpoint (ECS does not
# read it; its target group probes /health itself). Same contract as before:
# healthy on any status below 500, unhealthy on an error or after 4 s.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]

# dumb-init is PID 1 and execs Bun as its only child, forwarding SIGTERM (ECS's
# stop signal) to it. The base image puts a `node` on PATH, but it is a symlink
# to bun (/usr/local/bun-node-fallback-bin/node): there is no Node in this
# image, so every command names `bun` rather than a `node` that would run Bun
# while claiming otherwise.
ENTRYPOINT ["dumb-init", "--"]
CMD ["bun", "packages/backend/dist/index.js"]
