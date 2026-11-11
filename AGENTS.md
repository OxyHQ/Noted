# Noted

Oxy's local-first notes and meeting-capture app: an Expo frontend (`packages/frontend`) and its shared DTOs (`packages/shared-types`). Its server is Nilo; Noted has no backend of its own.

## Commands

```bash
bun install                                # postinstall builds shared-types
bun run dev                                # Expo app; bun run dev:frontend adds --clear --tunnel
bun run lint                               # Biome check; bun run lint:fix to apply
bun run typecheck
bun run --filter @noted/frontend test      # Vitest
bun run build:frontend                     # builds shared-types first
bun run test:worker                        # scripts/frontend-worker.test.ts
```

Use Bun only (pinned in `packageManager`). Run `bun run build:types` after changing a shared type.

## Map

- `docs/index.mdx`: architecture, artifact invariants, AI routes, moderation boundary.
- `packages/frontend/README.md`: local-first UI, capture, on-device models.
- `docs/sync-reset-recovery.md`: client design for remote reset or erase (proposal, not implemented).
- `docs/history/`: investigations; `docs/audits/`: dated audits.

## Conventions that differ from defaults

- Server work belongs in Nilo (`api.nilo.so`, contract `@oxy.so/nilo-contracts` `notes.ts`). Noted's own server is retired, so do not add a backend, database or server route here.
- A note's content is Nilo blocks edited with `@oxy.so/bloom-editor`, never Markdown. Recorder blocks are found by id (`lib/notes/blocks.ts` `GeneratedMap`), never by text, because text changes when the user edits.
- The local SQLite database is the frontend's read source of truth. Screens use `lib/db/live-query` only after `useLocalStore()` is ready and never query the remote API as a substitute, so offline behaviour stays correct.
- Artifact DTOs live in `@noted/shared-types`; the note's wire shape is Nilo's. Only `final` artifacts sync, inside the note's app data, written on its revision (a stale one is refused). An omitted artifact field means "unchanged" and an empty array means "clear". Contract: `docs/index.mdx`.
- Attachments are Nilo page files. Link each one with the owner's session (`lib/files/attachment-links.ts`, Oxy ADR 0043) and never unlink; removal, reconciling and file events are Nilo's. Noted holds no Oxy file reference of its own.
- Notes are private pages of the user's personal workspace, which takes no members. Offer no public, shared, collaborator or share-link surface; if that changes, revisit the CrowdSource decision in `docs/index.mdx` first.
- Speech transcription and transcript enhancement run on the user's device. Model weights may be downloaded; audio and transcript content must not be uploaded as a hidden fallback (privacy).
- Hosted point inference flows `Noted -> Oxy -> Kaana`. Agent, chat, tool or memory capability flows `Noted -> Alia -> Oxy -> Kaana`. Publishing a signed Noted event to Alia is not permission to call an inference provider.
- Own service calls use Oxy workload identity; customer API keys are external credentials and never replace a human account. Bind a product, app or agent by its exact opaque primary key, never by display name, sorted list, first result or fallback.
- This repository was forked from Clarity: a Clarity or retired-hosting reference is a leftover unless a document marks it as migration history. Fix it where you see it.

## Boundaries

Never:
- Add a Kaana hostname under `oxy.so`, a direct provider adapter, provider routing or an AI provider key. Kaana's only signed origin is `https://kaana.ai`, and provider keys live encrypted in Kaana PostgreSQL/KMS.
- Add a backend, database or server route to this repo (see Conventions).
- Use npm or yarn; the lockfile and CI assume Bun.

Ask first: changing `.github/workflows/` (the owner reviews every workflow because they can build, push or deploy).

## Testing

Run lint, typecheck and the frontend tests for any frontend change, and `bun run build:frontend` when touching `shared-types` or build config. Done means the CI list in `CONTRIBUTING.md` passes locally (`bunx biome ci --error-on-warnings .` is the exact lint gate).

## PR and commit rules

Follow the [Oxy contribution guide](https://github.com/OxyHQ/.github/blob/main/CONTRIBUTING.md) and `CONTRIBUTING.md`. Merging to main deploys the web app to Cloudflare, so keep PRs small and CI green.

## Secrets

Local overrides go in `packages/frontend/.env` (copy `.env.example`); never print or commit values. Deploy and signing secrets live in GitHub Actions secrets.

## Links

- [Oxy engineering standards](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/standards.md), [lint and format](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/lint-and-format.md), [build and runtime traps](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/build-and-runtime-traps.md)
- [npm releases](https://github.com/OxyHQ/oxy/blob/main/docs/npm-releases.md), [Bloom app conventions](https://github.com/OxyHQ/Bloom/blob/main/docs/app-conventions.mdx)

Owner: @NateIsern (Oxy). Last reviewed: 2026-11-11.
