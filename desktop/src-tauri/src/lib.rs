//! Noted Desktop.
//!
//! A shell: it opens a native window on the Noted web build
//! (`packages/frontend`'s `expo export --platform web` output) and adds the
//! things a browser cannot do. All note-taking logic stays in the TypeScript app,
//! so the desktop build records, transcribes and structures notes through exactly
//! the same pipeline as the web one (see `docs/desktop-audio.mdx`).
//!
//! What it adds so far, each only a way to ASK the app for something:
//!
//! - a tray icon with *New note*, *Show Noted* and *Quit*;
//! - a global shortcut (Ctrl+Shift+N, Cmd+Shift+N on macOS) for *New note*.
//!
//! "Ask" is literal. The shell shows the window and emits [`NEW_NOTE_EVENT`]; the
//! web app (`lib/desktop/bridge.ts`) decides what that means. Nothing here knows
//! what a note is.
//!
//! The tray labels are English for now: localising them means passing the app's
//! language to the shell, which is its own piece of work.

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

/// The event the web app listens for. Keep in step with `DESKTOP_EVENTS` in
/// `packages/frontend/lib/desktop/bridge.ts`, which has a test pinning the name.
pub const NEW_NOTE_EVENT: &str = "desktop://new-note";

/// Bring the main window to the front, wherever it has got to.
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Show the window and ask the app for a new note.
fn request_new_note(app: &AppHandle) {
    show_main_window(app);
    let _ = app.emit(NEW_NOTE_EVENT, ());
}

#[cfg(desktop)]
fn new_note_shortcut() -> tauri_plugin_global_shortcut::Shortcut {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

    // Cmd on macOS, Ctrl elsewhere: the key people already reach for.
    #[cfg(target_os = "macos")]
    let primary = Modifiers::SUPER;
    #[cfg(not(target_os = "macos"))]
    let primary = Modifiers::CONTROL;

    Shortcut::new(Some(primary | Modifiers::SHIFT), Code::KeyN)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                use tauri_plugin_global_shortcut::ShortcutState;

                if event.state() == ShortcutState::Pressed && *shortcut == new_note_shortcut() {
                    request_new_note(app);
                }
            })
            .build(),
    );

    builder
        .setup(|app| {
            let new_note = MenuItem::with_id(app, "new-note", "New note", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Noted", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&new_note, &show, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "new-note" => request_new_note(app),
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            // Not every desktop has a tray (GNOME ships none by default), and a missing
            // tray must not stop Noted opening: the window and the shortcut still work.
            if let Err(error) = tray.build(app) {
                eprintln!("could not create the tray icon: {error}");
            }

            // Another app may already own the shortcut. That must not stop Noted
            // opening: the tray still works, and the failure is only logged.
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;

                if let Err(error) = app.global_shortcut().register(new_note_shortcut()) {
                    eprintln!("could not register the new-note shortcut: {error}");
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Noted Desktop");
}
