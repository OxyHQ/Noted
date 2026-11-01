# Per-note 410 snapshot research

This experiment is disconnected. It adds no production migration, hook, syncer,
UI or audio operation. Nilo generation remains off. Do not deploy this as
quarantine or recovery.

The model captures a note and related SQLite rows together in one caller-owned
transaction after a verified `410 NOTE_DELETED`: the note, its outbox row, label
links and label definitions, folder, captures, transcript segments, artifacts,
overrides and attachment-link records. It stores them only in separate research
tables, not in the active outbox. Requiring the still-existing source upsert ID
avoids attributing an old response to a replacement outbox row. The tests use
real SQLite, including rollback, reopen and two controlled connections. A caller
can read a limited text preview; there is no UI, actual restore, outbound network
or automatic replay from these tables.

This preserves only database values in the tested transaction. It does not stop
the original outbox from sending, authorize a viewer, bind the operation to a
session through COMMIT, or fence clients on older versions. Captures contain
references, not audio bytes. A test calls the real Noted capture deletion and
artifact-store logic with an isolated filesystem backend and demonstrates that
legacy cleanup can remove the audio file after the snapshot while the copied
reference remains. The backend in that test is not the web or native adapter.
The model cannot protect against a recorder or remover that does not participate
in an independently verified physical-object protocol.

An additional isolated Chromium experiment used Noted's real web OPFS backend
and `deleteCaptureAudio`/`AudioArtifactStore`, the experimental snapshot statements, and Expo SQLite
58.0.14's web classes, worker and WASM. It wrote synthetic audio, snapshotted its
reference, then removed the audio through the store: the copied reference still
existed while the OPFS audio did not. Expo module registration and logging were
stubbed; this was not the complete app or its UI. A separate Node/SQLite test
uses the actual `deleteNoteRecordings` path with a controlled filesystem backend.
With the repository dependencies installed, reproduce the isolated browser test
from the repository root with:

```sh
CHROME_PATH=/path/to/chromium bun packages/frontend/docs/research/note-snapshot/run-browser-proof.cjs
```

The script creates a fresh temporary HTTP server, browser profile and synthetic
database/audio. It never opens a user's storage; its temporary directory is left
for inspection.

`CREATE TABLE AS SELECT` copies columns and values but no constraints. The
snapshot schema is tied to the current source schema and does not provide a safe
migration across future schema versions. Duplicate snapshot IDs reject rather
than reconcile an uncertain COMMIT. A later explicit account erase does not know
these research tables exist: a test demonstrates retained sensitive rows after
that erase. Production needs an explicit, reviewed retention/deletion and
recovery UX that honors user intent, includes attachments, prevents unwanted
replay, handles concurrent writers and mixed versions, and verifies physical
audio ownership/exclusion for every platform and historical path. The tests do
not prove multi-process behavior, native/web SQLite drivers, devices, durable
writes through power loss, remote attachment grants or cancellation of an
in-flight request.
