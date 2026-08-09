# Noted

A notes app by [Oxy](https://oxy.so). Write a note, or put the phone on the table and let it take the note for you — the recording is transcribed and structured on the device.

## What it does

- **Notes and labels** — colour, pin, archive, trash, search, and a masonry grid that packs cards by height.
- **Local-first** — every note is written to a per-account SQLite database first and synchronised afterwards, so the app works with no network and survives a process that dies mid-edit.
- **Recording** — started from any list of notes; it keeps running across screens and into the background, and the indicator follows it.
- **Transcription on the device** — whisper.cpp on a phone, transcribing while the meeting runs; an ONNX build of the same model in the browser. Nothing leaves the device.
- **A note, not a transcript** — a language model reads the recording and writes the note: a title, the points worth keeping, what was decided, what was left open.
- **Reminders** — with push notifications on native and Web Push in the browser.
- **Markdown export**, attachments, and an in-app feedback inbox.

## Monorepo

```
packages/
  frontend/       # @noted/frontend     — Expo app (iOS, Android, web)
  backend/        # @noted/backend      — Express API
  shared-types/   # @noted/shared-types — the DTOs both sides agree on
```

## Stack

- **Frontend** — Expo SDK 56 (React Native 0.85), expo-router, NativeWind 5, Reanimated, Zustand, TanStack Query, expo-sqlite
- **Backend** — Express, PostgreSQL (drizzle over postgres.js, via `@oxyhq/db`), Socket.IO, Redis
- **Auth** — Oxy (`@oxyhq/core`, `@oxyhq/services`); no app-local session handling
- **UI** — Bloom (`@oxyhq/bloom`) for dialogs, toasts and theming

## Development

```bash
bun install          # bun only — never npm or yarn

bun run dev          # frontend and backend together
bun run dev:frontend # Expo
bun run dev:backend  # Express

bun run web          # Expo on the web
bun run ios          # native build, iOS
bun run android      # native build, Android
```

Tests are `bun run test` inside `packages/frontend`; `bun run lint` at the root.

## Database

PostgreSQL, database `noted` on the shared `oxy-postgres` instance. Connection in `packages/backend/src/db/postgres.ts`, schema in `src/db/schema/`, migrations in `drizzle/`.

Two rules that are not obvious from the code:

- **Every generated migration needs a `-- oxy:deploy-phase=pre|post` marker.** `db:migrate` refuses to apply an unmarked one, before any DDL runs.
- **Postgres has no TTL index.** A table that would have carried one needs an entry in `src/db/expiry.ts`, or it grows forever with no error and no failing test.

## Deployment

Both halves ship from GitHub Actions:

| workflow | what it does |
|---|---|
| `ci.yml` | lint, tests, both builds, and a guard that refuses to let MongoDB back in |
| `deploy-aws.yml` | builds the linux/arm64 backend image, pushes it to ECR, and rolls the ECS service on `oxy-cluster` |
| `deploy-cloudflare.yml` | exports the Expo web build and deploys it to Cloudflare Pages |

The frontend deploy is gated on backend CI, so the web app cannot ship ahead of the API it talks to.

## Conventions

`AGENTS.md` is the single source of truth for how to work in this repo — coding standards, the Postgres rules above, and which references are deliberate rather than left over. `CLAUDE.md` only imports it.
