# Noted — Notes App by Oxy

Noted is a notes-and-labels app by Oxy with real-time sync, reminders, push notifications, and web push support.

Note: this repository was forked from Clarity, a different product. The READMEs have been rewritten; anything still saying Clarity — or naming DigitalOcean or MongoDB — is a leftover, not a second product.

## Monorepo Structure

- `packages/frontend/` (`@noted/frontend`) — Expo app (React Native + Web)
- `packages/backend/` (`@noted/backend`) — Express API
- `packages/shared-types/` (`@noted/shared-types`) — Shared TypeScript types

## Tech Stack

- **Frontend**: Expo SDK 56, NativeWind 5, Reanimated, Zustand, TanStack Query, expo-router
- **Backend**: Express, TypeScript, PostgreSQL (drizzle over postgres.js, via `@oxyhq/db`), Socket.IO, Redis
- **Auth**: `@oxyhq/core` (incl. `@oxyhq/core/server`), `@oxyhq/services`

## PostgreSQL

Database `noted` on the shared `oxy-postgres` instance, reached as
`postgres.internal.oxy.so` with `?sslmode=require` (the parameter group sets
`rds.force_ssl = 1`). Connection in `packages/backend/src/db/postgres.ts`, schema
in `src/db/schema/`, migrations in `drizzle/`.

Two rules that are not obvious from the code:

- **Every generated migration needs a `-- oxy:deploy-phase=pre|post` marker**;
  `db:migrate` refuses to apply an unmarked one, before any DDL runs.
- **Postgres has no TTL index.** Any table that would have carried one needs an
  entry in `src/db/expiry.ts`, or it grows forever with no error and no failing
  test. Two tables are registered there today.

Mongo was removed entirely in August 2026 — there is no `noted-production`
database and no `MONGODB_URI` anywhere. Comments elsewhere that mention Mongo are
deliberate records of why a Postgres decision was made, not leftovers.

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

## A note has two halves, and both cross the wire

The body is Markdown. Everything that makes a recorded note checkable — which
sentence came from which second, who was speaking, which revision of the
transcript a claim was checked against, which lines the user rewrote — is the
**artifact**, and it is a separate document with its own tables
(`note_artifacts`, `note_item_overrides`) on both the device and the server.

Four rules that are not visible from the code:

- **The domain lives in `@noted/shared-types`, not in the app.** The server
  stores the artifact, so it has an opinion about its shape; two copies of that
  opinion is the drift that makes a correct write parse to nothing on the far
  side. `CAPTURE_PROFILES` and `DOCUMENT_INTENTS` are `as const` tuples and their
  unions are DERIVED from them, so the server's validator and the client's type
  cannot disagree.
- **Only `final` artifacts sync.** A `live` one is rewritten every few seconds
  while somebody is still talking; uploading it would be a request per slice.
- **The write is a compare-and-swap in SQL, on both sides** — a `WHERE` on the
  upsert (`transcript_revision >= existing`), never a read-then-write in
  application code, which a slow request wins.
- **Absent ≠ empty.** A payload without `artifacts`/`itemOverrides` says nothing
  about them and changes nothing; an empty array says there are none and clears
  them. The feed read omits them on purpose, so a note from the feed must never
  be applied as though it had none.

## Reminders

`packages/backend/src/lib/reminders.ts` — `startReminderScheduler()` / `stopReminderScheduler()` manage the reminder cron; started in `src/index.ts`.

## Shared Types

`@noted/shared-types` exports `normalizeNoteColor` and domain DTOs. Build: `bun run build:shared-types`.

## Content moderation: Noted is deliberately NOT integrated with CrowdSource

Every other Oxy app reports to CrowdSource; Noted does not, and that is a decision rather than an oversight. **Noted has no public or shared surface at all** — every `Note` query is filtered by `oxyUserId` (list, get, patch, trash, restore, delete, and each `updateOne` inside the bulk reorder), socket rooms are joined only from the server-verified id (`user:${userId}`; clients cannot name a room), and no document carries a visibility, audience, collaborator or share-link field. So there is no stranger who could file a report, and no material a jury could be shown. Integrating anyway would mean an outbox, a dispatcher, a webhook receiver and a subject registry with **zero registered providers**: dead plumbing, plus a new deploy-time secret requirement and a `POST /reports` route with no caller, which every future reader has to understand before concluding it does nothing.

Two things that look like hooks and are not. `feedback` is a support inbox (user→operator, with its own `pending|reviewed|resolved` triage), so routing it to a jury of strangers would expose a user's bug report and device metadata to people with no reason to see it. And `note.attachments` holding bare Oxy file ids is exactly the shape moderation evidence wants — but the bytes live in Oxy storage under Oxy's credential, and Noted holds nothing but the id; if Oxy ever moderates stored files, that is oxy-api's job.

**The trigger to revisit:** the day Noted grows a genuinely shared surface — a published note, a public link, a collaborator on a note — the integration becomes one subject-provider file plus one line in a registry, consuming `@oxyhq/crowdsource-app`. Building the plumbing before that surface exists buys nothing and costs a subsystem.
