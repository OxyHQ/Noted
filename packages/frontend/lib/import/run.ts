/**
 * Writing parsed files into the local store.
 *
 * The caller injects the effects (creating a note, resolving labels, minting
 * ids) so the rules that matter here — what is too big to keep, what is skipped
 * and why — are tested without a device.
 */

import type { Label } from '@noted/shared-types';
import type { NoteInput } from '@/lib/db/notes-repo';
import { parseImportFile } from './parse';

/**
 * The server's ceilings for one note (`NOTE_LIMITS` and the body/title caps in
 * `routes/notes.ts`). A note over them would be created locally and then be
 * refused by every upload, leaving its outbox entry failing for good, so it is
 * skipped here with a reason instead.
 */
export const IMPORT_LIMITS = {
  title: 1_000,
  body: 100_000,
  checklist: 5_000,
  labels: 100,
} as const;

/** More than this in one go is a folder dump; do it in batches. */
export const MAX_IMPORT_FILES = 500;

export interface ImportFile {
  name: string;
  text: string;
}

export interface ImportDeps {
  makeId: () => string;
  createNote: (id: string, input: NoteInput) => Promise<unknown>;
  /** Labels the account already has. */
  labels: readonly Label[];
  /** Create a label, or resolve null if that was not possible (e.g. offline). */
  createLabel: (name: string) => Promise<Label | null>;
}

export interface ImportSummary {
  imported: number;
  skipped: { name: string; reason: string }[];
}

export async function runImport(
  files: readonly ImportFile[],
  deps: ImportDeps,
): Promise<ImportSummary> {
  const summary: ImportSummary = { imported: 0, skipped: [] };
  const labelIds = new Map(deps.labels.map((label) => [label.name.toLowerCase(), label.id]));

  const batch = files.slice(0, MAX_IMPORT_FILES);
  for (const file of files.slice(MAX_IMPORT_FILES)) {
    summary.skipped.push({
      name: file.name,
      reason: `more than ${MAX_IMPORT_FILES} files at once`,
    });
  }

  for (const file of batch) {
    const parsed = parseImportFile(file.name, file.text, deps.makeId);
    if (!parsed.ok) {
      summary.skipped.push({ name: file.name, reason: parsed.reason });
      continue;
    }
    for (const note of parsed.notes) {
      if (note.body.length > IMPORT_LIMITS.body) {
        summary.skipped.push({ name: file.name, reason: 'the note is too long' });
        continue;
      }
      if (note.checklist.length > IMPORT_LIMITS.checklist) {
        summary.skipped.push({ name: file.name, reason: 'the checklist is too long' });
        continue;
      }

      const ids: string[] = [];
      for (const name of note.labelNames.slice(0, IMPORT_LIMITS.labels)) {
        const key = name.toLowerCase();
        let id = labelIds.get(key);
        if (!id) {
          // A label that cannot be created is dropped from the note, not a
          // reason to lose the note.
          id = (await deps.createLabel(name))?.id;
          if (id) labelIds.set(key, id);
        }
        if (id) ids.push(id);
      }

      await deps.createNote(deps.makeId(), {
        title: note.title.slice(0, IMPORT_LIMITS.title),
        userBody: note.body,
        checklist: note.checklist,
        labels: ids,
        pinned: note.pinned,
        archived: note.archived,
        trashed: note.trashed,
        color: note.color,
      });
      summary.imported += 1;
    }
  }
  return summary;
}
