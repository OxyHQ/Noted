# Noted

> Universal standards live in `~/AGENTS.md`; Oxy-wide architecture lives in
> `~/Oxy/AGENTS.md` and `~/Oxy/docs/`. Product documentation belongs in
> `docs/`, history in git and current rollout status in issues. This file holds
> only hard rules, commands and pointers. **Budget: under 8 KB.**

Noted is Oxy's local-first notes and meeting-capture app: an Expo frontend and
its shared DTOs. Its server is Nilo; Noted has no backend of its own. This
repository was forked from Clarity; a Clarity or retired hosting reference is a
leftover unless a document explicitly marks it as migration history.

## Commands

```bash
bun install
bun run dev
bun run dev:frontend
bun run lint            # Biome (lint + format check); bun run lint:fix to apply
bun run typecheck
bun run --filter @noted/frontend test
bun run build:frontend
```

Use Bun only. Package order is `shared-types` before the frontend.

## Hard boundaries

- The app's server is Nilo (`api.nilo.so`): notes are rows of the user's
  personal-workspace `notes` database, served by Nilo's `/notes` (contract:
  `@oxy.so/nilo-contracts` `notes.ts`). A note's content is Nilo blocks,
  edited with Bloom's block editor (`@oxy.so/bloom-editor`), never Markdown;
  the recorder's blocks are known by id (`lib/notes/blocks.ts`
  `GeneratedMap`), never by text. Noted's own server (`api.noted.oxy.so`) is
  retired; do not add a backend, database or server route back to this
  repository. A server-side change belongs in Nilo.
- The local SQLite database is the frontend's read source of truth. Screens use
  `lib/db/live-query` only after `useLocalStore()` is ready; do not query the
  remote API directly as a substitute.
- Artifact DTOs live in `@noted/shared-types`; the note's wire shape is Nilo's.
  Only `final` artifacts sync, inside the note's app data (written on its
  revision; a stale one is refused), and omitted artifact fields mean
  “unchanged” while empty arrays mean “clear”. Full contract: `docs/index.mdx`.
- A note's attachments are Nilo page files. Noted links each one to Nilo with
  the OWNER's session (`lib/files/attachment-links.ts`, Oxy ADR 0043) and never
  unlinks; removing, reconciling and file events are Nilo's. Noted holds no
  Oxy file reference of its own (`docs/index.mdx`).
- Notes are private pages of the user's personal workspace, which takes no
  members. Noted itself has no public, shared, collaborator or share-link
  surface; Nilo can share a page, so if Noted ever offers that, revisit the
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
- Own service calls use Oxy workload identity; customer API keys are external
  credentials and never replace a human account. If a product/app/agent
  binding is introduced, use the exact opaque primary key; never discover by
  display name, sorted list, first result or fallback.

## Pointers

- `docs/index.mdx`: architecture, artifact invariants, AI routes and moderation
  boundary.
- `packages/frontend/README.md`: local-first UI, capture and on-device models.
- `CONTRIBUTING.md`: setup and CI commands layered on the Oxy organization
  guide.
