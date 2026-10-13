# Noted Desktop

A [Tauri v2](https://tauri.app) shell around the Noted web build. **Early skeleton:**
it opens a window on the app and does nothing else yet. The decision and the plan
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

`cargo check` is what CI runs (`.github/workflows/desktop.yml`).

## Before this ships

- The icons in `src-tauri/icons/` are **placeholders**: flat squares, not the Noted mark.
- `app.security.csp` is `null`. A shipped build needs a policy listing exactly the
  origins the app talks to (the Noted API, Oxy auth, the model hosts).
- No native capability is exposed yet. Each one added (tray, global shortcuts,
  system audio) gets its own entry in `capabilities/default.json`, and none of
  them carries note logic.
