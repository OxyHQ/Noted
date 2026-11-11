# 2026-11-01: IndexedDB audio deletion and aborted transactions

Historical check of change #246. The current coverage is
`packages/frontend/lib/audio/__tests__/backend-deletion.test.ts`.

The web audio backend (`lib/audio/backend.web.ts`) once resolved a deletion when its request
succeeded, even if the surrounding IndexedDB transaction then aborted, so a failed erasure could
be reported as done. The fix waits for transaction commit (`oncomplete`) and rejects on
`onabort`; later changes made the chunk and manifest deletion a single transaction (#258).

The fix was also exercised in headless Chromium with real IndexedDB: the base build reported
success when a listener aborted the transaction after the delete request succeeded; the fixed
build rejected, the stored bytes were still present after rollback, and a normal delete
completed. The abort was injected on purpose, so this shows the commit handling and not that the
abort occurs in production. It did not cover OPFS, the UI, native devices or files outside the
chunk backend. The harness hard-coded local paths and was not kept; the unit tests above simulate
the same events.
