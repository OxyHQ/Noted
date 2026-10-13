/**
 * The database driver for the Noted Desktop shell.
 *
 * The shell's webview (WebKitGTK) has no Storage API, so the web build's SQLite on
 * OPFS cannot open there. Rust holds the SQLite instead (`desktop/src-tauri/src/
 * db.rs`) and this adapts its commands to the shape the local store engine already
 * uses. The engine, the schema, the migrations and every query are the same ones the
 * phones and the browser run.
 *
 * `invoke` is injected so this can be tested against another SQLite without a
 * window, and so Tauri's API is only imported (lazily, by `loadTauriInvoke`) when
 * the app really is in the shell.
 */

import type { DatabaseDriver, EngineDatabase } from './client-engine';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** What crosses the bridge is JSON; the engine only binds null, numbers and strings. */
function toJson(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    throw new Error('binary values cannot be sent to the desktop store');
  }
  return value;
}

export function createDesktopDriver(getInvoke: () => Promise<Invoke>): DatabaseDriver {
  return {
    async open(name: string): Promise<EngineDatabase> {
      const invoke = await getInvoke();
      await invoke('db_open', { name });

      // `async` so that an unsendable value rejects instead of throwing before a
      // promise exists, which is how every caller of these methods expects to fail.
      const all = async <T>(sql: string, params: unknown[] = []) =>
        invoke<T[]>('db_all', { name, sql, params: params.map(toJson) });

      return {
        execAsync: (sql) => invoke<void>('db_exec', { name, sql }),
        runAsync: async (sql, params = []) =>
          invoke<{ changes: number }>('db_run', { name, sql, params: params.map(toJson) }),
        getAllAsync: all,
        getFirstAsync: async <T>(sql: string, params: unknown[] = []) =>
          (await all<T>(sql, params))[0] ?? null,
        closeAsync: () => invoke<void>('db_close', { name }),
      };
    },

    addChangeListener() {
      // The engine invalidates its own subscriptions on every write it makes, so it
      // does not need these; it logs this at debug level and carries on.
      throw new Error('the desktop store reports no native change events');
    },
  };
}

/** Tauri's `invoke`, imported only when it is needed. */
export async function loadTauriInvoke(): Promise<Invoke> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke as Invoke;
}
