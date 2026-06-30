# Noted — Notes App by Oxy

Noted is a notes-and-labels app by Oxy with real-time sync, reminders, push notifications, and web push support.

Note: the README.md in this repo still says "Clarity" — that branding is stale. The codebase, package names (`@noted/*`), and product are **Noted**.

## Monorepo Structure

- `packages/frontend/` (`@noted/frontend`) — Expo app (React Native + Web)
- `packages/backend/` (`@noted/backend`) — Express API
- `packages/shared-types/` (`@noted/shared-types`) — Shared TypeScript types

## Tech Stack

- **Frontend**: Expo SDK 56, NativeWind 5, Reanimated, Zustand, TanStack Query, expo-router
- **Backend**: Express, TypeScript, MongoDB/Mongoose, Socket.IO, Redis
- **Auth**: `@oxyhq/core` (incl. `@oxyhq/core/server`), `@oxyhq/services`

## MongoDB

Database: `noted-production` (passed to `mongoose.connect()` via `dbName`, NOT embedded in `MONGODB_URI`). See `packages/backend/src/lib/db.ts`.

## Backend Routes

- `packages/backend/src/routes/notes.ts` — Note CRUD
- `packages/backend/src/routes/labels.ts` — Label management
- `packages/backend/src/routes/notifications.ts` — Push notification delivery
- `packages/backend/src/routes/auth.ts` — Oxy auth webhook
- `packages/backend/src/routes/feedback.ts` — In-app feedback

## Key Models

- `packages/backend/src/models/note.ts` — Note (color, label associations, reminder)
- `packages/backend/src/models/label.ts` — Label
- `packages/backend/src/models/notification.ts` — Notification record
- `packages/backend/src/models/web-push-subscription.ts` — Web Push subscription

## Reminders

`packages/backend/src/lib/reminders.ts` — `startReminderScheduler()` / `stopReminderScheduler()` manage the reminder cron; started in `src/index.ts`.

## Shared Types

`@noted/shared-types` exports `normalizeNoteColor` and domain DTOs. Build: `bun run build:shared-types`.
