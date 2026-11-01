# Outbox revision and recovery research

This directory is disconnected from production. The migration, trigger and SQL
are only executed by the adjacent research tests. They do not protect Noted's
sync, activate Nilo's generation protocol, or change deletion and recovery.

Noted's current acknowledgement compares the sent note's `updated_at` with the
current value. Two edits can share a millisecond. If a second edit lands while an
older PATCH is in flight, its response can clear `dirty` and delete the single
outbox row, leaving the newer content unsent. A 410 response can also delete a
newer edit. The tests reproduce both using the real note repository, syncer,
SQLite migrations and SQLite, with a controlled API transport and database
adapter. No Nilo server, native/web SQLite driver or physical audio is involved.

The experimental statements use an outbox row ID and a monotonically incremented
revision. The SQLite trigger also detects a legacy producer updating an existing
row after migration. A different row receives a different AUTOINCREMENT ID under
the ordinary SQLite schema even when the revision starts again at zero. Tests
exercise rollback and a controlled reinsert. This assumes the same database and
unmodified SQLite sequence: it does not establish cross-process/session identity,
protect requests already sent, or constrain an older syncer whose acknowledgement
ignores revisions. It does not prevent the reset/erase resurrection race.

A revision cannot solve a 410 by itself: merely declining to acknowledge the old
response leaves the newer request able to receive another 410 and delete the note.
A real solution needs durable account-scoped quarantine before any destructive
pull/reset/erase, frozen note and child data, retained audio references, no
reelection of the old outbox intent, and an explicit recovery flow explaining a
remote deletion. Recovery must revalidate the observable session and establish a
new server generation/identity; no automatic re-upload. The current physical audio
stores, historical native WAV paths, other tabs and older clients do not yet
provide the ownership/exclusion needed to promise safe retention or removal.
Refer to the separate generation research in PR #253. Do not enable either
experiment until those contracts, error handling, mixed-client rollout, native
platforms and end-to-end tests are reviewed.
