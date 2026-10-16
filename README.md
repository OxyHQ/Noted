# Noted

A notes app by [Oxy](https://oxy.so). Write a note, or put the phone on the table and let it take the note for you — the recording is transcribed and structured on the device.

## What it does

- **Notes and labels** — colour, pin, archive, trash, search, and a masonry grid that packs cards by height.
- **Local-first** — every note is written to a per-account SQLite database first and synchronised afterwards, so the app works with no network and survives a process that dies mid-edit.
- **Recording** — started from any list of notes; it keeps running across screens and into the background, and the indicator follows it.
- **Transcription on the device** — whisper.cpp on a phone, transcribing while the meeting runs; an ONNX build of the same model in the browser. Nothing leaves the device.
- **A note, not a transcript** — a downloaded language model on the device reads the transcript and writes the note: a title, the points worth keeping, what was decided, and what was left open.
- **Reminders** — with push notifications on native and Web Push in the browser.
- **Markdown export**, attachments, and an in-app feedback inbox.

## Monorepo

```
packages/
  frontend/       # @noted/frontend     — Expo app (iOS, Android, web)
  shared-types/   # @noted/shared-types — note, label and artifact DTOs
desktop/          # Noted Desktop (Tauri)
```

Noted has no server of its own. Its notes are rows of the user's personal
workspace in [Nilo](https://github.com/OxyHQ/Nilo) (`api.nilo.so`), served by
Nilo's `/notes`; the old Noted API (`api.noted.oxy.so`) is retired.

## Stack

- **Frontend** — Expo SDK 57 (React Native 0.86), expo-router, NativeWind 5, Reanimated, Zustand, TanStack Query, expo-sqlite
- **Server** — Nilo (`api.nilo.so`), contract in `@oxy.so/nilo-contracts`
- **Auth** — Oxy (`@oxy.so/core`, `@oxy.so/services`); no app-local session handling
- **UI** — Bloom (`@oxy.so/bloom`) for dialogs, toasts and theming

## Development

```bash
bun install          # bun only — never npm or yarn

bun run dev          # Expo
bun run dev:frontend # Expo, with --clear --tunnel

bun run web          # Expo on the web
bun run ios          # native build, iOS
bun run android      # native build, Android
```

Tests are `bun run test` inside `packages/frontend`; `bun run lint` at the root.

In development the app talks to a local Nilo API on port 4001 of the host it was opened from; `EXPO_PUBLIC_API_URL` overrides it (`packages/frontend/lib/config.ts`).

## AI boundary

Speech transcription and transcript enhancement run on the user's device; they
do not fall back to a hosted provider. If Noted later adds hosted point
inference, its route is `Noted -> Oxy -> Kaana`. Agent, chat, tool or memory
features route `Noted -> Alia -> Oxy -> Kaana`.

Kaana is Oxy's only hosted inference data plane and its only canonical signed
origin is `https://kaana.ai`. AI provider credentials live only encrypted in
Kaana PostgreSQL/KMS, never in Noted environment variables or source. An Oxy
service application credential identifies Noted; it is not a provider key.

## Deployment

The web app ships from GitHub Actions; the server is Nilo's and deploys from that repository.

| workflow | what it does |
|---|---|
| `ci.yml` | lint, typecheck, tests and the Expo web build |
| `deploy-cloudflare.yml` | exports the Expo web build and deploys it as the Cloudflare Worker `noted`, serving `noted.oxy.so` |
| `desktop.yml` | builds Noted Desktop |
| `whisper-sidecar.yml` | builds and checks the desktop whisper.cpp sidecar |

## Conventions

Architecture and product contracts live in [`docs/index.mdx`](docs/index.mdx).
`AGENTS.md` contains only the hard rules, commands and documentation pointers
needed while changing the repository. `CLAUDE.md` only imports it.
