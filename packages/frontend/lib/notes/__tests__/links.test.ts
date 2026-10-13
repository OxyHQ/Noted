import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  execute: vi.fn(),
  executeTransaction: vi.fn(),
  getActiveViewerId: () => null,
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));

import { MIGRATIONS } from '@/lib/db/migrations';
import { backlinksQuery } from '@/lib/db/notes-repo';
import { appendLink, linkTitles, linkTo } from '@/lib/notes/links';

const sqlite = await import('node:sqlite').catch(() => null);

describe('linkTitles', () => {
  it('finds plain and labelled links, trimmed and de-duplicated', () => {
    expect(linkTitles('see [[Budget]] and [[ Budget ]] and [[Plan|the plan]]')).toEqual([
      'Budget',
      'Plan',
    ]);
  });

  it('ignores things that are not links', () => {
    expect(linkTitles('[single] [[]] [[ ]] [[a\nb]] [[nested [[x]]')).toEqual(['x']);
    expect(linkTitles('')).toEqual([]);
  });
});

describe('linkTo / appendLink', () => {
  it('builds a link from a title and refuses an empty one', () => {
    expect(linkTo('  My   note ')).toBe('[[My note]]');
    expect(linkTo('a [b] | c')).toBe('[[a b c]]');
    expect(linkTo('   ')).toBeNull();
  });

  it('appends on its own line without piling up blank lines', () => {
    expect(appendLink('', '[[A]]')).toBe('[[A]]');
    expect(appendLink('text\n\n', '[[A]]')).toBe('text\n[[A]]');
  });
});

describe('backlinksQuery against SQLite', () => {
  if (!sqlite) {
    it.skip('needs node:sqlite, which this runtime does not provide', () => {});
    return;
  }
  const db = new sqlite.DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) for (const statement of migration) db.exec(statement);
  const now = '2026-10-13T00:00:00.000Z';
  const add = (id: string, fields: Record<string, unknown>) => {
    const row = {
      id,
      title: '',
      body: '',
      generated_body: '',
      created_at: now,
      updated_at: now,
      ...fields,
    };
    const cols = Object.keys(row);
    db.prepare(
      `INSERT INTO notes (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    ).run(...(Object.values(row) as string[]));
  };
  add('target', { title: 'Budget Plan' });
  add('plain', { body: 'see [[budget plan]] for numbers' });
  add('labelled', { body: 'the [[Budget Plan|plan]]' });
  add('generated', { generated_body: 'Decision recorded in [[Budget Plan]]' });
  add('other', { body: 'see [[Something else]]' });
  add('trashed', { body: '[[Budget Plan]]', trashed: 1 });
  add('self', { id: 'target2', body: 'x' });
  add('wild', { body: 'a % sign and [[Budget_Plan]]' });

  const run = (target: { id: string; title: string }) => {
    const { sql, params } = backlinksQuery(target);
    return (db.prepare(sql).all(...(params as string[])) as { id: string }[])
      .map((r) => r.id)
      .sort();
  };

  it('finds notes that link by title, case-insensitively, in either half of the text', () => {
    expect(run({ id: 'target', title: 'Budget Plan' })).toEqual(['generated', 'labelled', 'plain']);
  });

  it('skips trashed notes, the note itself, and treats _ and % as text', () => {
    expect(run({ id: 'plain', title: 'Budget Plan' })).not.toContain('plain');
    expect(run({ id: 'target', title: 'Budget Plan' })).not.toContain('wild');
    expect(run({ id: 'target', title: 'Budget Plan' })).not.toContain('trashed');
  });

  it('returns nothing for a note without a title', () => {
    expect(run({ id: 'target', title: '  ' })).toEqual([]);
  });
});
