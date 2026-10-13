/**
 * Turning files from other note apps into notes.
 *
 * Pure on purpose: parsing is where a foreign format's quirks live (front
 * matter, a Takeout JSON with timestamps in microseconds), and none of it should
 * need a device or a database to be tested. Nothing here touches storage — the
 * caller decides what to do with the result.
 */

import { type ChecklistItem, type NoteColor, normalizeNoteColor } from '@noted/shared-types';

export interface ParsedNote {
  title: string;
  /** What the user wrote, as Markdown. */
  body: string;
  checklist: ChecklistItem[];
  /** Names, not ids: the importer maps them onto this account's labels. */
  labelNames: string[];
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  color: NoteColor;
}

export type ParseResult = { ok: true; notes: ParsedNote[] } | { ok: false; reason: string };

const EMPTY: Omit<ParsedNote, 'title' | 'body'> = {
  checklist: [],
  labelNames: [],
  pinned: false,
  archived: false,
  trashed: false,
  color: normalizeNoteColor('default'),
};

/** Longest label name worth keeping; a pasted paragraph in `tags:` is not one. */
const MAX_LABEL_LENGTH = 60;

function cleanLabels(names: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== 'string') continue;
    // Obsidian tags are written `#tag` and nest with `/`; the label is the tag.
    const trimmed = name.trim().replace(/^#/, '');
    if (trimmed && trimmed.length <= MAX_LABEL_LENGTH) seen.add(trimmed);
  }
  return [...seen];
}

/* ── Markdown, Obsidian, plain text ──────────────────────────── */

interface FrontMatter {
  tags: string[];
  rest: string;
}

/**
 * Split a leading `---` YAML block from the text.
 *
 * Only `tags` is read, in the three shapes people write it: `tags: [a, b]`,
 * `tags: a, b` and a `- a` list under `tags:`. A full YAML parser is not worth
 * its weight for one key, and anything it does not understand is left out
 * rather than guessed at — but the block itself is always removed, so the note
 * body never starts with metadata.
 */
function splitFrontMatter(text: string): FrontMatter {
  const match = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { tags: [], rest: text };

  const lines = match[1].split(/\r?\n/);
  const tags: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = /^tags?:\s*(.*)$/i.exec(lines[index]);
    if (!line) continue;
    const inline = line[1].trim();
    if (inline) {
      tags.push(...inline.replace(/^\[|\]$/g, '').split(','));
    } else {
      for (let next = index + 1; next < lines.length; next += 1) {
        const item = /^\s+-\s+(.*)$/.exec(lines[next]);
        if (!item) break;
        tags.push(item[1]);
      }
    }
    break;
  }
  return {
    tags: cleanLabels(tags.map((tag) => tag.trim().replace(/^["']|["']$/g, ''))),
    rest: text.slice(match[0].length),
  };
}

function titleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[^.]+$/, '').trim();
}

export function parseMarkdown(filename: string, text: string): ParsedNote {
  const { tags, rest } = splitFrontMatter(text.replace(/\r\n/g, '\n'));
  const lines = rest.split('\n');

  // The first line that is not blank decides the title: a leading `# Heading`
  // is the title (and leaves the body), anything else keeps the filename.
  const first = lines.findIndex((line) => line.trim() !== '');
  const heading = first >= 0 ? /^#\s+(.+?)\s*#*\s*$/.exec(lines[first]) : null;
  const title = heading ? heading[1].trim() : titleFromFilename(filename);
  const body = (heading ? lines.slice(first + 1) : lines).join('\n').trim();

  return { ...EMPTY, title, body, labelNames: tags };
}

/* ── Google Keep (Takeout JSON) ──────────────────────────────── */

interface KeepNote {
  title?: unknown;
  textContent?: unknown;
  listContent?: unknown;
  labels?: unknown;
  isPinned?: unknown;
  isArchived?: unknown;
  isTrashed?: unknown;
  color?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseKeep(text: string, makeId: () => string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  if (!isRecord(json) || !('listContent' in json || 'textContent' in json)) {
    return { ok: false, reason: 'not a Google Keep note' };
  }
  const note = json as KeepNote;

  const checklist: ChecklistItem[] = [];
  if (Array.isArray(note.listContent)) {
    for (const item of note.listContent) {
      if (!isRecord(item) || typeof item.text !== 'string' || item.text.trim() === '') continue;
      checklist.push({ id: makeId(), text: item.text, checked: item.isChecked === true });
    }
  }
  const labelNames = Array.isArray(note.labels)
    ? cleanLabels(note.labels.map((label) => (isRecord(label) ? label.name : undefined)))
    : [];

  return {
    ok: true,
    notes: [
      {
        title: typeof note.title === 'string' ? note.title : '',
        body: typeof note.textContent === 'string' ? note.textContent : '',
        checklist,
        labelNames,
        pinned: note.isPinned === true,
        archived: note.isArchived === true,
        trashed: note.isTrashed === true,
        // Keep writes SHOUTING colour names; unknown ones fall back to default.
        color: normalizeNoteColor(
          typeof note.color === 'string' ? note.color.toLowerCase() : 'default',
        ),
      },
    ],
  };
}

/* ── Dispatch ─────────────────────────────────────────────────── */

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'txt']);

/** Parse one picked file by its extension. */
export function parseImportFile(filename: string, text: string, makeId: () => string): ParseResult {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return { ok: true, notes: [parseMarkdown(filename, text)] };
  }
  if (extension === 'json') return parseKeep(text, makeId);
  return { ok: false, reason: `.${extension || '?'} files are not supported` };
}
