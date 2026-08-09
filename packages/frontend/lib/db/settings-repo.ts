/**
 * Per-device preferences, in the local store.
 *
 * These are settings about this device's behaviour — which speech model its
 * hardware should load, what language to expect — rather than anything about the
 * account, so they live in SQLite next to the notes and are never synced. A
 * phone that downloaded the small model and a laptop that cannot run one at all
 * have no business overwriting each other's choice.
 */

import { execute, executeTransaction, type Row } from '@/lib/db/client';
import { useLiveQuery } from '@/lib/db/live-query';

export const SETTING_KEYS = {
  /** Which speech model transcription loads. */
  sttModel: 'stt.model',
  /** BCP-47 code, or `auto` to let the model decide. */
  sttLanguage: 'stt.language',
  /** Whether to transcribe while recording rather than afterwards. */
  liveNotes: 'stt.live',
} as const;

interface SettingRow extends Row {
  key: string;
  value_json: string;
}

const SETTINGS_SQL = 'SELECT key, value_json FROM app_settings';

/**
 * Values are stored as JSON so a setting can grow past a string without a
 * migration, and a row written by an older build stays readable.
 */
function mapSettings(rows: readonly SettingRow[]): Map<string, unknown> {
  const settings = new Map<string, unknown>();
  for (const row of rows) {
    try {
      settings.set(row.key, JSON.parse(row.value_json));
    } catch {
      // A row nobody can parse is a row nobody can act on. Skipping it leaves
      // the caller's default in place, which is the behaviour of an absent
      // setting — the one case every caller already handles.
      continue;
    }
  }
  return settings;
}

/** Every stored setting, kept current as they change. */
export function useSettings(): { settings: Map<string, unknown>; isLoading: boolean } {
  const { data, isLoading } = useLiveQuery<SettingRow, Map<string, unknown>>({
    sql: SETTINGS_SQL,
    mapRows: mapSettings,
  });
  return { settings: data, isLoading };
}

/** One setting, with the default applied when it is absent or the wrong type. */
export function readSetting<T>(
  settings: Map<string, unknown>,
  key: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): T {
  const value = settings.get(key);
  return isValid(value) ? value : fallback;
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
  await executeTransaction([
    {
      sql: `INSERT INTO app_settings (key, value_json) VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
      params: [key, JSON.stringify(value)],
    },
  ]);
}

/**
 * Read a setting once, outside React.
 *
 * The recorder needs the chosen model at the moment it opens the microphone, not
 * at the moment a component rendered.
 */
export async function loadSetting<T>(
  key: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): Promise<T> {
  const rows = await execute<SettingRow>('SELECT key, value_json FROM app_settings WHERE key = ?', [
    key,
  ]);
  return readSetting(mapSettings(rows), key, isValid, fallback);
}
