/**
 * What the command palette lists for a given search.
 *
 * Pure, so the rules a palette lives or dies by — what matches, in what order,
 * how many notes — are tested without rendering it. The palette's own filter is
 * switched off in favour of this: its default would hide the note results, which
 * were already filtered by the database and rarely contain the typed words in
 * their title.
 */

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  /** Matched but never shown: "preferences" finds Settings. */
  keywords?: string[];
  shortcut?: string;
  run: () => void;
}

export interface PaletteNote {
  id: string;
  title: string;
}

export interface PaletteEntry {
  id: string;
  label: string;
  group: string;
  keywords?: string[];
  shortcut?: string;
  run: () => void;
}

/** More than this and the list stops being something a person scans. */
export const MAX_NOTE_RESULTS = 8;

function matches(command: PaletteCommand, query: string): boolean {
  const haystack = [command.label, ...(command.keywords ?? [])].join('\n').toLowerCase();
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

export function buildPaletteEntries(input: {
  query: string;
  commands: readonly PaletteCommand[];
  /** Notes the database matched for `query`. Ignored when there is no query. */
  notes: readonly PaletteNote[];
  untitled: string;
  notesGroup: string;
  openNote: (id: string) => void;
}): PaletteEntry[] {
  const query = input.query.trim().toLowerCase();
  if (!query) return [...input.commands];

  const commands = input.commands.filter((command) => matches(command, query));
  const notes = input.notes.slice(0, MAX_NOTE_RESULTS).map((note) => ({
    id: `note:${note.id}`,
    label: note.title.trim() || input.untitled,
    group: input.notesGroup,
    run: () => input.openNote(note.id),
  }));
  // Commands first: someone typing "trash" more often wants the Trash than a
  // note that happens to mention it, and the notes are right below.
  return [...commands, ...notes];
}
