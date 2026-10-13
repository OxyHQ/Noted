/**
 * The one place the web app talks to the Noted Desktop shell.
 *
 * The desktop build is the same web app inside a Tauri window (`desktop/`), so
 * everything native reaches it as an event the shell emits. Keeping the
 * listening here means no other file asks "am I in a desktop window?": they get a
 * `DesktopCommand` or they get nothing, and the browser build is untouched.
 *
 * Tauri's API is imported only when a desktop window is detected, so the web
 * bundle never loads it.
 */

/** What the shell can ask the app to do. Grows with the shell, one command at a time. */
export type DesktopCommand = 'new-note';

/** Event names, as `desktop/src-tauri/src/lib.rs` emits them. */
export const DESKTOP_EVENTS: Record<DesktopCommand, string> = {
  'new-note': 'desktop://new-note',
};

/** Where each command takes the person. */
export function routeFor(command: DesktopCommand): string {
  switch (command) {
    case 'new-note':
      return '/n/new';
  }
}

/** Whether this page is running inside the Noted Desktop shell. */
export function isDesktop(
  scope: object | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  return scope !== undefined && '__TAURI_INTERNALS__' in scope;
}

type Unlisten = () => void;
interface EventApi {
  listen: (event: string, handler: () => void) => Promise<Unlisten>;
}

/**
 * Call `onCommand` whenever the shell asks for something. Resolves to a function
 * that stops listening. A no-op outside the desktop shell.
 */
export async function listenForDesktopCommands(
  onCommand: (command: DesktopCommand) => void,
  options: {
    desktop?: boolean;
    loadEvents?: () => Promise<EventApi>;
  } = {},
): Promise<Unlisten> {
  const desktop = options.desktop ?? isDesktop();
  if (!desktop) return () => undefined;

  const { listen } = await (options.loadEvents ?? (() => import('@tauri-apps/api/event')))();
  const unlistens = await Promise.all(
    (Object.keys(DESKTOP_EVENTS) as DesktopCommand[]).map((command) =>
      listen(DESKTOP_EVENTS[command], () => onCommand(command)),
    ),
  );
  return () => {
    for (const unlisten of unlistens) unlisten();
  };
}
