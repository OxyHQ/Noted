# Oxy One shared attachment storage (local draft)

Noted does not allocate a storage allowance. Attachments are Oxy file IDs;
`FileManagement` in Oxy Services owns upload, selection and quota error display.
Noted has no presigned PUT implementation or backend upload endpoint. The approved
100 GB is the same decimal 100,000,000,000-byte Oxy account benefit used by other
apps. The effective limit comes from Oxy `/storage/usage` through the SDK; a
larger individual subscription is preserved by Oxy's maximum composition policy.
There is no Noted product ID or grant hardcoded here and no activation/config
change in this repository.

Account settings now show authoritative used/limit bytes in decimal GB, an
honest unconfigured or metadata-admission status, manual refresh, and 30-second
refresh while mounted. Queries are keyed by both account and session, are not
persisted, and discard a response arriving after either changes. The file picker
also fences its callbacks by both account and session, including same-account
session changes, so a delayed picker cannot mutate the next account's note.

Notes, on-device capture, local editing and export have no subscription gate.
Attaching an existing file does not upload another copy; removing a reference
from a note does not delete the shared Oxy file. Cancellation and expiry do not
rewrite notes; the next Oxy usage response supplies the effective account limit
and future uploads are admitted by Oxy. Reads of attachment content remain
protected by Oxy's file authorization; Noted's backend stores references, not
bytes or a separate allowance.

## Local validation

- Credential-free public checkout base: `bd4599b9a9fe205fb93b5ec221dc9d0e3b891ab5`.
- `bun install --ignore-scripts` succeeded. Native dependency lifecycle scripts
  were deliberately not executed; this is not a native device build.
- `bun run build:types` and frontend `tsc --noEmit` passed.
- `bun run --filter @noted/frontend test`: 72 files, 849 tests passed.
- `bun run validate:no-mongo`: source scan and 33 guard cases passed.
- Eight added shared-storage regressions cover actual-limit preservation (free, bundle, larger individual),
  refreshed cancellation/expiry limits, unconfigured status, malformed responses,
  and delayed picker account/session/sign-out isolation. Metadata cache keys include account and session; pending private responses are rejected after switching.
- UI copies are Spanish and English; the other 14 locale catalogues contain
  explicit English draft copies, pending translation review.

Physical object enforcement, CORS and SDK upload error tests belong in Oxy,
where bytes are admitted and uploaded. This Noted draft cannot prove bucket CORS,
physical variant/multipart/orphan limits, or a native device upload. No live
catalogue, quota adapter, subscription, charge, deployment or publication was
created. UI layout requires a foreground browser/device review before release.

## Reserved quota correction

Oxy `reservedBytes` is the total quota-counted amount: active and trash original/
variant metadata plus uncleaned durable byte reservations not represented by those
files. It is not an amount to add again to active bytes. The panel distinguishes
active-file metadata from total quota consumption and shows the difference as
trash, pending uploads or cleanup holds. Admission headroom is clamped to zero
when total reserved quota meets/exceeds the limit. It remains unknown when the
configured API lacks a reservation snapshot; active bytes alone never establish
available space. Decimal reservation strings are parsed with BigInt, including
amounts exceeding JavaScript safe integers. A smaller reserved snapshot is
conservatively floored at active bytes because the API totals are separate reads.

Correction validation: `bun run --filter @noted/frontend test` passed all 854
tests in 72 files (13 shared-storage regressions); frontend `tsc --noEmit`
passed. For final draft SDK type validation, freshly built local Oxy Core and
Contracts `dist` were copied into ignored installed packages only. No package
manifest was modified; publication/adoption of the compatible SDK remains a
release gate. Safe integer numeric reservation totals from older SDKs are also
accepted; unsafe, negative or fractional numeric totals fail closed.
