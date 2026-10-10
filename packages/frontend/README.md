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
| `app/` | the routes, file-based via expo-router — `(app)/` uses Bloom AppShell; web routes flow in the document, native routes use a stack; `n/[id]` opens the note editor above the notes |
| `components/` | the UI, including `notes/` (cards, grid, editor chrome) and `capture/` (the recording indicator) |
| `lib/db/` | the local-first SQLite store: schema, migrations, repositories, and the sync that reconciles it with the API |
| `lib/capture/` | recording: which engine holds the microphone, and what happens to a recording when it stops |
| `lib/stt/` | speech to text — whisper.cpp on native, an ONNX build of the same model in the browser |
| `lib/enhance/` | reading a transcript with a language model and writing the note from it |
| `lib/stores/` | zustand stores for state that outlives a screen |

Speech and enhancement models run on the device and never fall back to a hosted
provider. If a future frontend feature needs hosted point inference, it calls
the Noted/Oxy boundary rather than Kaana or a provider directly. Provider keys
must never use an `EXPO_PUBLIC_` variable.

## Things worth knowing before changing them

- **The local database is the source of truth for reading.** Screens query SQLite through `lib/db/live-query`, never the API directly, and must not query before `useLocalStore()` reports ready — a query with no active account has no database file to open.
- **Local mutations run offline.** Every TanStack Query mutation that writes SQLite uses `networkMode: 'always'` and `retry: false`. Its default online mode pauses local saves without connectivity; automatic retries can replay an unacknowledged commit or a write after an account switch. Remote synchronization still respects connectivity.
- **One engine holds the microphone.** `CaptureEngineHost` mounts it once and publishes to the capture store; the indicator is drawn from that store in two places (inside the shell’s scenes and inside the note editor) because they are different layers of the app. A second engine would be a second microphone.
- **Bloom owns shared controls and surfaces.** Editor actions use Bloom buttons, checklists use Checkbox, and note/composer chrome uses Card. Keep note tint and masonry measurements in the app; size the grid from its actual container. Use an animated layout wrapper around Card, with ordinary `style` values on Card, to preserve its geometry across web/native.
- **Unit tests do not catch layout, hover or animation bugs.** Verify those in a real, foregrounded browser tab.
- **App preferences use Bloom SettingsModal.** Open sections with `useNotedSettings().open(section?)` through the lazy `NotedSettingsProvider`. Legacy `/settings/*` links open the same dialog. Transcription settings mount only after the local store is ready.
- **Stickers need their animation players.** Bloom's optional players must be direct frontend dependencies: `@lottiefiles/dotlottie-react` on web and `lottie-react-native` on native. `lib/lottieWeb.web.ts` configures the bundled `@lottiefiles/dotlottie-web` renderer before stickers mount; Metro already accepts `.wasm` assets. Missing players silently show still images in production. Validate an exported app in a foreground browser with reduced motion disabled: the renderer must load from the app's origin and the sticker's canvas frames must change. Reduced motion should keep the still image.

`AGENTS.md` at the repository root carries the standards that apply to every change here.

## Layout and scrolling

Bloom owns the app frame, navigation, headers, surfaces and scroll geometry.
The web shell uses `AppShell` with `scroll="document"`; the browser document is
the page's only scroller. Its routes render through Expo Router's unstyled
navigation APIs. Do not put a viewport-bound Stack, `ScrollViewStyleReset`,
overflow-hidden wrapper or wheel forwarding layer around the web shell.
Native keeps its stack and uses bounded screen scrolling. The plain sidebar uses
`navigationAlign="content"`: Bloom keeps the desktop panel gutter and removes the
outer frame when navigation moves into the compact drawer. Do not add window
breakpoint padding around that shell.

Expo's single-page export reads `public/index.html`; `app/+html.tsx` does not
configure that output. Keep the document-growth reset and page metadata in the
public template, and check the exported HTML when changing the host layout.

Pages compose Bloom `Screen`, `PageHeader`, `ScreenScrollView` and
`useScrollRestoration` for their platform. Search belongs in the notes content;
the header keeps the page title and grouped actions. Shell bottom chrome uses
the measured `AppShell.bottomBar` slot, and page actions use `Screen.primaryAction`;
do not replace their clearance with fixed bottom offsets. Note colors, note
packing and local search remain product behavior.

`Screen` inherits the containing panel fill and owns the positioning of its
`header` slot, including the panel inset. Put `PageHeader` directly in that slot;
do not add a second sticky wrapper or repaint the page background inside a panel.
Native stack scenes use `useSurfaceFill()` so retained routes stay opaque with
the same fill as the shell.

The web editor uses Bloom's public controlled `Dialog` API because its visible
state belongs to the route. A dismissal requests navigation; `usePreventRemove`
keeps the route and dialog mounted until the last local save succeeds. Do not
move that navigation into imperative Dialog's post-exit `onClose`: a failed save
would leave a hidden draft. Bloom owns the backdrop, Escape handling, focus and
scroll lock. The root navigator retains the notes route behind the dialog using
Expo Router's route descriptors; native retains its transparent-modal stack.
The editor opts out of document scrolling: every ready-state wrapper, including
`LocalStoreBoundary`, must keep Bloom's bounded flex height so the editor's
`ScrollView` can overflow. Document-growth styles belong only to document routes.
Its toolbar and recording controls occupy normal flow below the scroller; the
content needs ordinary spacing, not extra clearance for a floating footer.

Verify document scrolling, sticky navigation and headers in a real browser,
including small viewports. Read and edit a note longer than the dialog; verify
its scroll offset advances and its final paragraph is reachable. Open an editor
after scrolling and return without losing the background position; check browser
Back and direct note links.
Backdrop and Escape dismissal must keep an unsaved draft visible if storage
fails, and restore scrolling after a successful save. Shared behavior missing
from Bloom must be fixed and published upstream before updating the app.

## Editing and recovery

The editor saves to SQLite before leaving a note. Its status describes the local
save, not server sync: when a write fails, the draft stays open with a retry
action. New-note creation and subsequent edits run in order, including edits made
while the initial write is pending. Refreshing a browser with unsaved edits asks
before leaving. Pending editor writes are cancelled when the editor unmounts,
and writes carry the original account identity across asynchronous work.

Quick capture keeps its title, body and color until creation succeeds. Its archive
action creates an archived note, and checklist/file shortcuts continue editing the
same saved note. Discarding a nonempty quick draft asks for confirmation. Checklist
items can be added with Enter or the plus button; leaving the new-item field also
commits its text.

A browser storage failure offers recovery instructions without automatically
clearing OPFS or deleting another account's data. A mismatched database owner is
rejected rather than wiped. Attachment loading failures offer a retry action.

Edits update only explicitly changed fields. The editor captures the draft's
common ancestor when queueing a save, so a later peer refresh cannot turn an
untouched field into an apparent edit. User/generated body halves compare their
SQLite snapshot before committing; a stale snapshot rolls back labels and outbox
writes too, then recomposes from the current row. Only that confirmed rollback
is retried. An unanswered write after a connection failure is not replayed.
New-note drafts retain one creation ID and their first attempted input until
success or discard. A manual retry confirms that ID with an insert-only create;
it preserves an existing row and applies only subsequent draft changes. This
avoids duplicate notes when the first insert committed but its response was lost.

## Browser storage coordination

Multiple tabs can read and edit the same account without closing another tab.
`lib/db/client.web.ts` preserves the native client API and forwards operations
through `web-store-broker.ts`. One document owns the origin-wide Web Lock
`noted:expo-sqlite:opfs` and uses `client-engine.ts` to access Expo SQLite. Other
documents communicate over BroadcastChannel; they do not open another OPFS pool.
The owner also uses the broker queue. Account selection and each operation,
including whole transactions, run together in that queue.

Each tab owns its session generation. Requests and responses carry that identity;
committed table changes invalidate only matching account subscriptions. An owner
change refreshes subscriptions. The storage lock lasts until document destruction,
including across sign-out and backgrounding: closing a SQLite connection does not
release the worker's OPFS access handles. Do not steal ownership after a heartbeat
timeout or reset the pool to recover from contention.

Sync holds a separate per-account Web Lock for the complete network/reconciliation
cycle. Each recording holds a per-account/per-capture lock from before its first
persisted row until the microphone stops and final persistence finishes. Startup
recovery tries each capture lock without waiting and only interrupts an abandoned
capture; opening a tab must never interrupt another tab's active recording.

Validate with real browser storage as well as unit tests: start two tabs together,
edit from both, observe changes without reloading, close the SQLite owner and
continue in the remaining tab, then reload and verify unsynchronized notes remain.
Include distinct accounts and startup while another tab records. TanStack Query
still owns mutation/resource state; note reads remain SQLite live queries.

## Settings ownership

`NotedSettingsProvider` lives at the root, but loads Bloom's `SettingsModal` only
when `useNotedSettings().open(section?)` is called. Settings own their controls;
Bloom owns the navigation, responsive layout, scrolling, focus and dismissal.
Account and language controls close settings before opening the Oxy-owned dialog.

Existing `/settings` and `/settings/{general,storage,transcription,feedback}` links
open the corresponding section over the notes route. They do not create a second
settings sidebar or a separate settings screen. Appearance uses Bloom's preset
catalogue names and gates; adding a Bloom preset must not require a Noted locale
key before the settings dialog can open.

Transcription controls mount inside `LocalStoreBoundary` only after the current
account's SQLite store is ready. Signed-out users see the sign-in empty state;
model downloads remain on the device, without an audio or transcript upload.
