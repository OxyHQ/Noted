# Noted

> Universal standards live in `~/AGENTS.md`; Oxy-wide architecture lives in
> `~/Oxy/AGENTS.md` and `~/Oxy/docs/`. Product documentation belongs in
> `docs/`, history in git and current rollout status in issues. This file holds
> only hard rules, commands and pointers. **Budget: under 8 KB.**

Noted is Oxy's local-first notes and meeting-capture app: Expo frontend,
Express API and shared DTOs. This repository was forked from Clarity; a Clarity,
retired hosting or MongoDB reference is a leftover unless a document explicitly
marks it as migration history.

## Commands

```bash
bun install
bun run dev
bun run dev:frontend
bun run dev:backend
bun run lint
bun run build
bun run --filter @noted/backend test
bun run validate:no-mongo
bun run db:migrate --target-database=noted_dev
```

Use Bun only. Package order is `shared-types` before frontend/backend.

## Hard boundaries

- The backend is PostgreSQL/Drizzle only. Never add MongoDB, Mongoose, a dual
  store or a fallback store. `bun run validate:no-mongo` is a reintroduction
  gate, not a migration checklist.
- Every generated PostgreSQL migration needs an
  `-- oxy:deploy-phase=pre|post` marker. Production uses `db:migrate`; do not
  bypass its exact-target and phase checks with `drizzle-kit migrate`.
- PostgreSQL has no TTL index. Register every expiring table in
  `packages/backend/src/db/expiry.ts`; a deadline that only exists in the
  schema never deletes anything.
- The local SQLite database is the frontend's read source of truth. Screens use
  `lib/db/live-query` only after `useLocalStore()` is ready; do not query the
  remote API directly as a substitute.
- Note/artifact DTOs live in `@noted/shared-types`. Only `final` artifacts sync,
  writes are compare-and-swap on `transcriptRevision`, and omitted artifact
  fields mean “unchanged” while empty arrays mean “clear”. Full contract:
  `docs/index.mdx`.
- Every backend note query is scoped by the server-verified `oxyUserId` and
  socket rooms are derived server-side as `user:${userId}`. Noted has no public,
  shared, collaborator or share-link surface. If that changes, revisit the
  CrowdSource decision documented in `docs/index.mdx` before shipping.

## AI and platform ownership

- Speech transcription and transcript enhancement currently run on the user's
  device. Model weights may be downloaded to that device; audio and transcript
  content must not be uploaded as a hidden fallback.
- Any future hosted point inference flows `Noted -> Oxy -> Kaana`. Any agent,
  chat, tool or memory capability flows `Noted -> Alia -> Oxy -> Kaana`.
  Publishing a signed Noted event to Alia is an agent-runtime integration, not
  permission to call an inference provider.
- Kaana is the sole hosted inference data plane and its only canonical signed
  origin is `https://kaana.ai`. Never add a Kaana hostname under `oxy.so`, a
  direct provider adapter, provider routing or an AI provider environment key.
  Provider keys live only encrypted in Kaana PostgreSQL/KMS.
- Oxy `ApplicationCredential` values identify Noted as a service. They are not
  provider keys and never replace a human account. If a product/app/agent
  binding is introduced, use the exact opaque primary key; never discover by
  display name, sorted list, first result or fallback.

## Pointers

- `docs/index.mdx`: architecture, artifact invariants, AI routes and moderation
  boundary.
- `packages/backend/README.md`: API, environment and PostgreSQL rules.
- `packages/frontend/README.md`: local-first UI, capture and on-device models.
- `CONTRIBUTING.md`: setup and CI commands layered on the Oxy organization
  guide.
