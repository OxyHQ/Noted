# @noted/frontend

The Noted app: iOS, Android and web from one Expo codebase. See the [repository README](../../README.md) for what the product is and how the pieces fit.

## Running it

```bash
# from the repository root
bun run dev:frontend

# or from this package
bun run web
bun run ios
bun run android
```

`bun run test` runs the suite (vitest, scoped to the platform-free logic in `lib/`).

## Where things are

| path | what lives there |
|---|---|
| `app/` | the routes, file-based via expo-router — `(app)/` is the authenticated drawer, `n/[id]` is the note editor, presented as a transparent modal above it |
| `components/` | the UI, including `notes/` (cards, grid, editor chrome) and `capture/` (the recording indicator) |
| `lib/db/` | the local-first SQLite store: schema, migrations, repositories, and the sync that reconciles it with the API |
| `lib/capture/` | recording: which engine holds the microphone, and what happens to a recording when it stops |
| `lib/stt/` | speech to text — whisper.cpp on native, an ONNX build of the same model in the browser |
| `lib/enhance/` | reading a transcript with a language model and writing the note from it |
| `lib/stores/` | zustand stores for state that outlives a screen |

## Things worth knowing before changing them

- **The local database is the source of truth for reading.** Screens query SQLite through `lib/db/live-query`, never the API directly, and must not query before `useLocalStore()` reports ready — a query with no active account has no database file to open.
- **One engine holds the microphone.** `CaptureEngineHost` mounts it once and publishes to the capture store; the indicator is drawn from that store in two places (inside the drawer's scenes and inside the note editor) because they are different layers of the app. A second engine would be a second microphone.
- **Unit tests do not catch layout, hover or animation bugs.** Verify those in a real, foregrounded browser tab.

`AGENTS.md` at the repository root carries the standards that apply to every change here.
