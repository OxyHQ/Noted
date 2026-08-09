/**
 * Where the app offers to start a recording.
 *
 * Pure and separate from the control itself because this rule decides whether a
 * feature is visible at all: get it wrong in one direction and the microphone
 * button follows the user onto the settings screen, and in the other it
 * disappears from the notes entirely. Neither failure announces itself, so it is
 * worth being able to test.
 *
 * An allow-list, not a list of exclusions: a screen added later has to opt in,
 * rather than inheriting a floating microphone because nobody remembered to
 * exclude it.
 */

/** Routes that are lists of notes. `expo-router` strips `(group)` segments. */
const NOTE_LISTS = new Set(['/', '/reminders', '/labels', '/archive', '/trash']);

/** A single note, `/n/<id>`. */
const NOTE_DETAIL_PREFIX = '/n/';

export function showsRecordButton(pathname: string): boolean {
  return NOTE_LISTS.has(pathname) || pathname.startsWith(NOTE_DETAIL_PREFIX);
}
