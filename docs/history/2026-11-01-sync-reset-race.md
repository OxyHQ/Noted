# 2026-11-01: sync resuming after a remote reset or erase

Historical investigation. Current design: [sync-reset-recovery.md](../sync-reset-recovery.md).
Checked against Noted `4dece0a` and Nilo `807427f`, on isolated worktrees and a disposable
PostgreSQL database.

## Finding

Both cases start with a synced cursor and a new local note in the outbox. Another operation then
resets the workspace or calls `POST /notes/erase` before the client resumes `syncNotes`.

- The unsent note is published and `GET /notes/:id` answers 200 in both cases.
- After a reset the sync response carries `reset: true`; after an erase it carries
  `reset: false`.
- Separately, an erase that resolved the old workspace home and stalled can answer 200 after a
  reset while leaving a note created in the new home untouched.

The harness used the real `syncNotes`, local repository and SQLite migrations on the client, and
the real Nilo routes and PostgreSQL on the server, with synthetic authentication and simulated
attachment links. It ordered the operations sequentially, so it did not cover every
interleaving or any native device.

## What was prototyped

- **Server fence (Nilo):** a per-workspace generation compared under a shared workspace lock on
  note create, edit and delete, advanced under an exclusive lock by reset and erase, opt-in per
  request. This landed in Nilo disabled by default
  ([notes-generation-experiment.md](https://github.com/OxyHQ/Nilo/blob/main/docs/notes-generation-experiment.md)).
  Review reproduced and fixed a stale label returned after erase, a null readback after commit
  and a broadcast sent before the outer commit. The proposed foreign-key migration took
  `ShareRowExclusiveLock` on `workspaces`; the shipped migration creates the table without one.
- **Client metadata (Noted):** an additive migration capturing the generation in the outbox
  transaction, plus snapshot, quarantine and erase-journal experiments. None of it was merged:
  independent review showed that `capture.id` does not identify the physical audio and that
  journaling a path without an exclusive reservation can capture someone else's audio.

The requirements the client work uncovered are carried in the proposal doc.

## Not kept

The prototype patches (about 1.2 MB of cumulative review cuts), review logs and one-off audit
tests were working artifacts of an unmerged prototype and were not carried over. They contained
local worktree paths and test-runner logs of intermediate failures.
