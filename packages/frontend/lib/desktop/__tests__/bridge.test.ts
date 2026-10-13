import { describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_EVENTS,
  isDesktop,
  listenForDesktopCommands,
  routeFor,
  type DesktopCommand,
} from '@/lib/desktop/bridge';

describe('isDesktop', () => {
  it('is true only inside the Tauri shell', () => {
    expect(isDesktop({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(isDesktop({})).toBe(false);
    expect(isDesktop(undefined)).toBe(false);
  });
});

describe('routeFor', () => {
  it('sends a new-note request to the new-note screen', () => {
    expect(routeFor('new-note')).toBe('/n/new');
  });
});

function fakeEvents() {
  const handlers = new Map<string, () => void>();
  const unlisten = vi.fn();
  const listen = vi.fn(async (event: string, handler: () => void) => {
    handlers.set(event, handler);
    return unlisten;
  });
  return { api: { listen }, handlers, listen, unlisten };
}

describe('listenForDesktopCommands', () => {
  it('does nothing, and loads nothing, outside the desktop shell', async () => {
    const loadEvents = vi.fn();
    const stop = await listenForDesktopCommands(vi.fn(), { desktop: false, loadEvents });
    expect(loadEvents).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it("turns the shell's events into commands", async () => {
    const events = fakeEvents();
    const onCommand = vi.fn<(command: DesktopCommand) => void>();
    await listenForDesktopCommands(onCommand, {
      desktop: true,
      loadEvents: async () => events.api,
    });

    events.handlers.get(DESKTOP_EVENTS['new-note'])?.();
    expect(onCommand).toHaveBeenCalledWith('new-note');
  });

  it('stops listening to every event when told to', async () => {
    const events = fakeEvents();
    const stop = await listenForDesktopCommands(vi.fn(), {
      desktop: true,
      loadEvents: async () => events.api,
    });
    stop();
    expect(events.unlisten).toHaveBeenCalledTimes(Object.keys(DESKTOP_EVENTS).length);
  });

  it('uses the same event names the Rust shell emits', () => {
    // desktop/src-tauri/src/lib.rs: NEW_NOTE_EVENT. If one changes, so must the other.
    expect(DESKTOP_EVENTS['new-note']).toBe('desktop://new-note');
  });
});
