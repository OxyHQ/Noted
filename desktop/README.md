# Noted Desktop

A [Tauri v2](https://tauri.app) shell around the Noted web build. **Early skeleton:**
it opens a window on the app, a tray menu (New note / Show Noted / Quit) and a
global *New note* shortcut (Ctrl+Shift+N; Cmd+Shift+N on macOS). That is all. The decision and the plan
are in [`docs/desktop-audio.mdx`](../docs/desktop-audio.mdx) (issue #91).

Not part of the Bun workspace on purpose: it is a Rust crate that only needs the
web build's output, and keeping it out leaves `bun install` unchanged.

## Build it

Prerequisites: [Tauri's system dependencies](https://tauri.app/start/prerequisites/)
and a stable Rust toolchain.

```bash
bun install
bun run build:frontend              # writes packages/frontend/dist
cd desktop/src-tauri
cargo run                           # or: cargo tauri build  (needs tauri-cli)
```

CI runs `cargo check --locked`, builds the shell and runs it for 20 s on Linux (Xvfb), macOS and Windows to check it starts; that is all it proves (see the workflow).

`cargo check --locked` is what CI runs (`.github/workflows/desktop.yml`); `src-tauri/Cargo.lock` is committed, so changing a dependency means committing that file.

## Before this ships

- The icons in `src-tauri/icons/` are **placeholders**: flat squares, not the Noted mark.
- `app.security.csp` is `null`. A shipped build needs a policy listing exactly the
  origins the app talks to (the Noted API, Oxy auth, the model hosts).
- The tray labels are English; localising them means passing the app's language to
  the shell. The shortcut is fixed and may clash with another app's: if so it is
  logged and skipped, and the tray still works.
- No JS-callable native capability exists. Each one added (e.g. system audio) gets
  its own entry in `capabilities/default.json`, and none of them carries note logic.
