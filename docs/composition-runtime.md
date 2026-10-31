# Composition runtime verification

Noted already composes its main layout through Bloom. The shell owns navigation,
its bottom slot and document geometry; routes compose `Screen`, `PageHeader` and
scroll restoration. The note editor uses a route-controlled `Dialog` with a
bounded scrolling body while the background route remains mounted. Keep the
local-store readiness boundary, save guards, note tint and masonry policy in
Noted. The frontend README describes these ownership boundaries.

`scripts/verify-composition.mjs` exercises that existing composition in Chromium
using 32 synthetic notes, including two long notes. The notes enter through the
normal sync response, SQLite and live-query path. It creates a fresh browser
context, supplies a synthetic cached identity, blocks service workers, denies
all external requests except explicit synthetic GET responses, and allows only
local Metro WebSockets. It never supplies real credentials or changes real data.
Expected console resource errors reflect denied SDK background requests.

## Run

Install the locked dependencies and build the shared types from the repository
root:

```sh
bun install --frozen-lockfile
bun run build:types
```

Start Metro from `packages/frontend` with the fixture endpoints:

```sh
EXPO_PUBLIC_OXY_CLIENT_ID=composition-fixture \
EXPO_PUBLIC_OXY_API_URL=https://oxy.invalid \
EXPO_PUBLIC_API_URL=https://nilo.invalid \
bunx expo start --web --port 8147 --clear
```

In a second terminal, run from the repository root. Supply an existing Playwright
installation with its Chromium browser; the probe adds no application dependency.

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/@playwright/test \
CONSUMER_COMMIT=$(git rev-parse HEAD) \
PROBE_OUTPUT=/tmp/noted-composition-audit \
bun scripts/verify-composition.mjs
```

`NOTED_URL` can select another localhost port. The output contains screenshots,
geometry, intercepted request metadata and package provenance in `audit.json`.
The script exits unsuccessfully if its geometry or restoration assertions fail.

## Scope

The baseline was measured on consumer `1f9b478c6fb69f0df6460ff96a2debec46c476af`
with published Bloom 15.10.1 and Services 13.0.0. No local Bloom mirror or layout
changes were used. At widths 1280, 768, 767 and 390, the loaded document grows
beyond the viewport without horizontal overflow. The section transition from
Notes to Archive and back restores offsets 480 → 0 → 480. The desktop editor
scrolls independently inside a 647 px body containing 1492 px of content while
the background stays at 480 px. Escape and a physical backdrop click both return
to that position. At 390 px, the editor body scrolls while the document remains
at 480 px, and Escape preserves that background position too. No uncaught
browser errors occurred.

This is a browser composition check, not native-device evidence or a complete
editor test. It does not validate local-save failure recovery, attachments,
recording, model downloads or real authentication. Their existing tests and
product-specific verification remain necessary. In particular, do not remove
root providers by analogy with newer Bloom releases: ownership must be checked
against the installed version and verified again after an upgrade.
