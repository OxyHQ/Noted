# Contributing to Noted

Noted is a notes and labels app by Oxy, with real time sync, reminders, push notifications and web push.

**The contribution process lives in the [Oxy organisation CONTRIBUTING guide](https://github.com/OxyHQ/.github/blob/main/CONTRIBUTING.md)**: reporting an issue, filing a feature request, opening a pull request, code review, licensing. It applies here unchanged. This file layers on top of it the same way `AGENTS.md` files layer, so it is short on purpose: it carries only what is different about this repository.

## Stale Clarity branding

Noted was started from the Clarity codebase and some of that branding has outlived the fork. `README.md` still says "Clarity", and until this file was rewritten so did the whole of it. The product, the package names (`@noted/*`) and the code are **Noted**. Anything you find still saying Clarity in this repository is a leftover, not a second product, and is worth fixing where you see it.

## Prerequisites

- **Bun.** The package manager for every Oxy repository, never npm or yarn. The pinned version is `packageManager` in the root `package.json`, and CI installs that exact version.
- **Node.js 22.** The runtime the backend is built and deployed on. CI pins it alongside bun.
- **PostgreSQL 17**, to run the backend — `docker compose -f docker-compose.postgres.yml up -d postgres`, then `bun run db:migrate --target-database=noted_dev`. The test suite does not need one.
- **Redis**, optional. Caching and Socket.IO scaling fall back gracefully without it.

## Setup

```bash
git clone https://github.com/OxyHQ/Noted.git && cd Noted
bun install
cp packages/backend/.env.example packages/backend/.env   # fill in your values
bun run dev                                              # every package at once
```

Focused commands:

```bash
bun run dev:backend    # API only
bun run dev:frontend   # Expo app only (runs with --clear --tunnel)
```

`packages/frontend` has its own `.env.example`; copy that too if you are working on the app.

## Layout

A bun workspaces monorepo on the standard Oxy three package shape:

| Package | Stack | Purpose |
| --- | --- | --- |
| `packages/backend` (`@noted/backend`) | Express + TypeScript | Core API runtime |
| `packages/frontend` (`@noted/frontend`) | Expo (React Native and Web) | Main app: web, iOS, Android |
| `packages/shared-types` (`@noted/shared-types`) | TypeScript | Note and label DTOs, `normalizeNoteColor` |

`shared-types` has to be built before either consumer, which is why `build:frontend` and `build:backend` both build it first. Run `bun run build:types` after changing a shared type.

## Tests

```bash
bun run --filter @noted/backend test
```

Vitest. Place test files next to the source as `*.test.ts`. `packages/backend` is the only package with a suite today, and it mocks its data layer, so nothing needs to be running.

CI runs the following on every pull request, and each line runs locally as written:

```bash
bun run --filter @noted/backend lint
bun run --filter @noted/backend test
bun run build:backend
bun run build:frontend
```

## Conventions

Coding standards for this repository are in `AGENTS.md` at the repository root, including the route and model map and the reasoning behind Noted deliberately not integrating with CrowdSource. `AGENTS.md` is read directly by Claude Code, Codex, Cursor and Copilot, and it is the file to update when a convention changes.

One thing worth knowing before your first pull request: **Noted has no shared or public surface.** Every note query is scoped to the owning `oxyUserId` and socket rooms are derived server side from the verified user id, never named by the client. If you add a feature that changes that, say so explicitly in the pull request, because a good deal of the design in `AGENTS.md` rests on it.
