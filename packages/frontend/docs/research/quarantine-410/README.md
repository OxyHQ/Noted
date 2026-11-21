# 410 quarantine and text recovery research

This code is disconnected from Noted. It is not a production migration,
syncer, recovery screen, audio adapter or authorization check. It does not
activate Nilo generation and must not be used as a production safety barrier.

Nilo's `POST /notes` returns `410 NOTE_DELETED` for an ID with a tombstone;
its PATCH of a missing note returns 404. Noted sends attachment links before
that POST and cannot undo those effects after a refusal. The current 410 path
can remove a locally newer edit. Pull tombstones also delete notes and outbox
rows, and a workspace reset invokes local account erasure, including audio.

The SQLite-only experiment records a quarantine marker for the still-existing
note and exact upsert row in the same caller-owned transaction. It keeps the
original note, outbox and capture references and gives a *cooperating* syncer a
selector that skips the marked note. A model of explicit user confirmation copies
only previewed text and blocks to a separate local-only draft table. It checks
that those text fields did not change between preview and copying, leaves the
original in place and does not create an outbox row. It is intentionally not a
complete note recovery: metadata, attachments, audio and other related data are
not copied. A previewed text value already released to a caller cannot be revoked
from that caller's memory. The proposed draft table is not an app screen.
The selector also skips a later deletion intent for that note; adopting it would
require an explicit, tested flow for honoring that deletion rather than silently
leaving it queued. The preview only validates its three text fields, not audio,
attachments, account identity or changes to unrelated note fields.
An already-created research draft survives deletion of the original. It must not
be used until the app defines retention and erasure of every recovered copy and
the ordering of an explicit delete against a concurrent copy.
Repeating the exact same copy while the source is still present is idempotent;
reusing its draft ID for different text or time fails. This does not reconcile an
uncertain COMMIT after the source is removed or the account/session changes.

The tests use actual SQLite migrations and database transactions. Their filesystem
fixture is just an isolated file: leaving it unchanged during the model's SQL and
text copy does not prove physical ownership, playback, persistence or immunity
to an independent remover. A second database models separation but does not
validate account/session identity or the real lifecycle, including A→B→A.
Identical IDs and text in two databases allow the model to copy from the wrong
database if the caller passes it; comparing content is not an account binding.

Before any adoption, all writers and syncers must participate, including older
clients, pull tombstones and reset/erase, conflict-copy paths and recording
producers. The app must establish an account/session-bound transaction through
COMMIT, handle uncertain outcomes and retries, and prevent old in-flight work
from publishing data. Recovery needs an actual user interface, unambiguous remote
deletion semantics, durable journal/reconciliation and a verified way to retain,
restore and erase physical audio across native and web stores. Current legacy
clients can ignore the marker and still send or delete. A file path, capture ID,
viewer ID or SQLite reference alone is not physical ownership. No guarantee is
made for mixed versions, multiple processes, old native WAV files, remote
attachment grants, power loss or requests already sent.
