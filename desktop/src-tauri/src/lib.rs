//! Noted Desktop.
//!
//! This is only a shell: it opens a native window on the Noted web build
//! (`packages/frontend`'s `expo export --platform web` output) and provides
//! nothing else yet. All note-taking logic stays in the TypeScript app, so the
//! desktop build records, transcribes and structures notes through exactly the
//! same pipeline as the web one (see `docs/desktop-audio.mdx`).
//!
//! Native capabilities — tray, global shortcuts, desktop notes, and system-audio
//! capture delivered to the TypeScript `AudioSource` — are added here one at a
//! time, each behind a Tauri permission, and none of them carries note logic.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Noted Desktop");
}
