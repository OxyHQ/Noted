# Sync after a remote reset or erase: client design (proposal)

Status: **not implemented in Noted.** Nilo ships the server half behind a flag that is off;
no Noted client sends or stores a generation. The server half and its limits are in
[Nilo's notes generation experiment](https://github.com/OxyHQ/Nilo/blob/main/docs/notes-generation-experiment.md).
The investigation that motivated this is in
[history/2026-11-01-sync-reset-race.md](./history/2026-11-01-sync-reset-race.md).

## Problem

A device with unsent edits can resume `syncNotes` after another device reset the workspace or
ran `POST /notes/erase`. The unsent notes are then published into the fresh workspace. After a
reset the next pull answers `reset: true` and the client drops its local data
(`eraseLocalAccountData` in `lib/db/sync.ts`), unsent edits included.

## Server contract available today

When Nilo enables the protocol, an opted-in client asks for a generation with
`GET /notes/sync?generationAware=1` and sends it back in `X-Notes-Generation` on note create,
edit and delete. A stale token gets `409 NOTES_GENERATION_CHANGED`; reset and erase advance the
generation. The token is a concurrency identifier, not authorization. Clients that omit the
header are not fenced.

## Client invariants required before adoption

1. **Generation is captured with the edit.** Each outbox intent takes its generation from
   committed state in the same SQLite transaction as the edit, for every outbox producer
   including conflict copies. Intents that exist without a generation (including every
   pre-upgrade outbox row) are unknown and never inherit the current generation just because a
   pull finished.
2. **No silent overwrite across epochs.** The outbox keeps one row per note and reads current
   content at send time. Before accepting another edit to a note under a different generation,
   the previous state of the note and its children must be preserved recoverably. Per-instance
   locks do not cover other tabs or devices.
3. **A generation 409 is not a version conflict.** It stops sending for the stale epoch and
   keeps notes, outbox, captures, transcripts and audio for explicit recovery. It must not run
   `eraseLocalAccountData` as a generic reaction to reset.
4. **Quarantine is durable and per account**, separate from the synced view. State transition
   and links to recordings commit atomically before rows are cleaned; files are never deleted or
   moved blindly. A restore creates new identities and a new intent under the current
   generation; it never replays the old operation.
5. **Local erase coordinates with sync.** Erase started on this device runs under
   `withAccountSyncLock`, cannot sweep an edit made after the erase, and resumes after an audio
   cleanup failure without reporting false success. In-flight requests and other devices are
   fenced by the server.
6. **Attachment links are outside the fence.** `linkNoteAttachments` calls Oxy before the Nilo
   POST and is not rolled back by a later 409. The effect of a stale link needs defining; a
   shared or referenced file is never deleted without proper authorization.

## Rollout order

1. Additive SQLite migration; transactional generation capture for all outbox producers;
   preserve existing entries as unknown. Test an edit racing a state change and two tabs.
2. Quarantine with data and recordings: account isolation, recovery, failure and restart,
   remote reset and local erase followed by new creation. Decide how a user who wants the audio
   gone permanently is served.
3. Send the header on every step of note create, PATCH and DELETE without replacing it during
   retries; verify preflight; skip linking attachments for a known-stale operation.
4. Test real HTTP with PostgreSQL and SQLite, both lock orders, several tabs and network
   errors; measure server lock cost; audit every Nilo writer before claiming coverage.
5. Phase the rollout. Legacy clients must be able to upgrade and recover their outbox, and
   native binaries ship before the server rejects operations without a generation.

## Audio authority (required for quarantine and erase)

Recovery and erase touch recordings, so they need a physical-object authority that does not
exist yet. Without it the design fails closed.

- **Lock the physical object** (`audio:` plus the store id), not the capture row or the viewer.
  Every recorder, copier and deleter that can reach it takes part, including other accounts and
  old versions. A lease on `(viewerId, capture.id)` does not prove this: a capture can point at
  another active source.
- **Destination reservation is exclusive and durable** from before the destination enters the
  journal until cleanup. Generating a UUID and checking absence afterwards is not ownership. A
  destination that belongs to someone else is never recorded as deletable.
- **Delete by identity, atomically.** The physical id distinguishes versions that reuse a path;
  comparing identity and deleting must be one storage operation, and absence is an idempotent
  result that cannot delete a later object. Without proof that no other account or snapshot
  shares the object, stop.
- **Journal first.** Record reservation and intent before writing and persist progress before
  retrying. An object is never deleted merely because SQLite lists it as an orphan. On failure
  the source stays; the bytes reserved by earlier attempts count against an explicit budget.
- **The storage backends cannot do this today.** `ChunkBackend` (`lib/audio/backend.ts`) has no
  exclusive reservation or conditional delete across OPFS, IndexedDB and native files, and Web
  Locks only help if every participant takes the same key. Native recordings can also sit at
  `captures/<id>/audio.<ext>` (`lib/audio/capture-directory.ts`), a path the quarantine design
  must reject or handle explicitly.
- **A crash during explicit erase** after the "physical delete started" flag is committed is
  indistinguishable from a file deleted without a record. Lifting the write fence or restoring
  snapshots as ready would then be unsafe; the user needs a visible persistent state and a way
  to retry deleting the recorded version.
- **Text recovery for audio of unknown ownership** is only a partial read (`id`, `title`,
  `body_text`): derived text can omit structure, checklists, transcripts and attachments, and is
  sensitive. Authorizing a save, share or clipboard copy by checking SQLite at read time is not
  enough, because the delete can begin right after the check and published copies cannot be
  recalled. It needs an exclusion respected by every process, tab and device, revalidation of
  account and session (including A to B to A), and an explicit user intent that is compatible
  with the earlier decision to delete.
