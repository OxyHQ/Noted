import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  execute: vi.fn(),
  executeTransaction: vi.fn(),
  getActiveViewerId: () => null,
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));

import { MIGRATIONS } from '@/lib/db/migrations';
import { noteListQuery, searchTerms } from '@/lib/db/notes-repo';

// The SQL runs for real, on the real schema: a LIKE/json_each mistake would
// otherwise only show up as "search finds nothing" on a device.
const sqlite = await import('node:sqlite').catch(() => null);

describe('searchTerms', () => {
  it('lowercases, splits on whitespace, de-duplicates and caps the count', () => {
    expect(searchTerms('  Budget  FRIDAY budget ')).toEqual(['budget', 'friday']);
    expect(searchTerms(undefined)).toEqual([]);
    expect(searchTerms('   ')).toEqual([]);
    expect(searchTerms('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('note search against SQLite', () => {
  if (!sqlite) {
    it.skip('needs node:sqlite, which this runtime does not provide', () => {});
    return;
  }
  const db = new sqlite.DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) for (const statement of migration) db.exec(statement);

  const now = '2026-10-13T00:00:00.000Z';
  const addNote = (id: string, fields: Record<string, unknown> = {}) => {
    const row = {
      id,
      title: '',
      body: '',
      generated_body: '',
      checklist_json: '[]',
      ...fields,
      created_at: now,
      updated_at: now,
    };
    const columns = Object.keys(row);
    db.prepare(
      `INSERT INTO notes (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    ).run(...(Object.values(row) as string[]));
  };

  addNote('title', { title: 'Quarterly Budget' });
  addNote('body', { body: 'remember to call the bank on friday' });
  addNote('generated', { generated_body: 'Decision: ship the redesign' });
  addNote('checklist', {
    checklist_json: JSON.stringify([{ id: 'x', text: 'Buy oat milk', checked: false }]),
  });
  addNote('labelled', { title: 'Untitled' });
  addNote('spoken', { title: 'Meeting' });
  addNote('percent', { body: 'we hit 100% of the target' });
  addNote('trashed', { title: 'Budget old', trashed: 1 });

  db.exec(`INSERT INTO labels (id, name, updated_at) VALUES ('l1', 'Finance', '${now}')`);
  db.exec(`INSERT INTO note_labels (note_id, label_id) VALUES ('labelled', 'l1')`);
  db.exec(
    `INSERT INTO captures (id, note_id, state, started_at, created_at, updated_at)
     VALUES ('c1', 'spoken', 'done', '${now}', '${now}', '${now}')`,
  );
  db.exec(
    `INSERT INTO transcript_segments (id, capture_id, start_ms, end_ms, text, created_at)
     VALUES ('s1', 'c1', 0, 1000, 'the launch moves to Thursday', '${now}')`,
  );

  const search = (q: string, extra: Record<string, unknown> = {}) => {
    const { sql, params } = noteListQuery({ q, ...extra });
    return (db.prepare(sql).all(...(params as string[])) as { id: string }[]).map((r) => r.id);
  };

  it('finds a word in the title, body, generated text, checklist, label and transcript', () => {
    expect(search('quarterly')).toEqual(['title']);
    expect(search('bank')).toEqual(['body']);
    expect(search('redesign')).toEqual(['generated']);
    expect(search('oat')).toEqual(['checklist']);
    expect(search('finance')).toEqual(['labelled']);
    expect(search('thursday')).toEqual(['spoken']);
  });

  it('needs every term, wherever each one lives', () => {
    expect(search('meeting thursday')).toEqual(['spoken']);
    expect(search('meeting redesign')).toEqual([]);
  });

  it('does not match the JSON keys of a checklist', () => {
    expect(search('checked')).toEqual([]);
  });

  it('treats % and _ as text', () => {
    expect(search('100%')).toEqual(['percent']);
    expect(search('%')).toEqual(['percent']);
    expect(search('_')).toEqual([]);
  });

  it('still respects the view', () => {
    expect(search('budget')).toEqual(['title']);
    expect(search('budget', { view: 'trashed' })).toEqual(['trashed']);
  });
});
