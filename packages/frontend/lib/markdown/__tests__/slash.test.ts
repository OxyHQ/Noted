import { describe, expect, it } from 'vitest';
import {
  SLASH_COMMANDS,
  SLASH_COMMAND_IDS,
  applySlashCommand,
  filterSlashCommands,
  slashContext,
} from '@/lib/markdown/slash';

const labels = {
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  bullets: 'Bulleted list',
  numbers: 'Numbered list',
  tasks: 'Task list',
  quote: 'Quote',
  code: 'Code block',
  table: 'Table',
  divider: 'Divider',
} as const;

const find = (id: string) => {
  const command = SLASH_COMMANDS.find((c) => c.id === id);
  if (!command) throw new Error(id);
  return command;
};

describe('slashContext', () => {
  it('opens on a slash that starts a line or follows a space', () => {
    expect(slashContext('/', 1)).toEqual({ start: 0, query: '' });
    expect(slashContext('hello /he', 9)).toEqual({ start: 6, query: 'he' });
    expect(slashContext('one\n/tas', 8)).toEqual({ start: 4, query: 'tas' });
  });

  it('stays closed for a slash inside a word, a path or a URL', () => {
    expect(slashContext('and/or', 6)).toBeNull();
    expect(slashContext('see https://x.test/a', 20)).toBeNull();
    expect(slashContext('a/b/c', 5)).toBeNull();
  });

  it('closes once a space is typed after the query', () => {
    expect(slashContext('/head ing', 9)).toBeNull();
  });

  it('only looks at the line the caret is on', () => {
    expect(slashContext('/h\nplain', 8)).toBeNull();
  });

  it('is null when the caret is before the slash', () => {
    expect(slashContext('text /h', 2)).toBeNull();
  });
});

describe('filterSlashCommands', () => {
  const ids = (query: string) => filterSlashCommands(query, labels).map((c) => c.id);

  it('lists everything for an empty query', () => {
    expect(ids('')).toEqual([...SLASH_COMMAND_IDS]);
  });

  it('matches the translated label, the id and English keywords', () => {
    expect(ids('quo')).toEqual(['quote']);
    expect(ids('todo')).toEqual(['tasks']);
    expect(ids('h2')).toEqual(['h2']);
    expect(ids('rule')).toEqual(['divider']);
  });

  it('ranks names that start with the query above ones that only contain it', () => {
    // "list" starts no label here but is contained in three; "head" starts three.
    expect(ids('head').slice(0, 3)).toEqual(['h1', 'h2', 'h3']);
    expect(ids('numbered')[0]).toBe('numbers');
  });

  it('is empty for nonsense', () => {
    expect(ids('zzzz')).toEqual([]);
  });

  it('matches what the person sees in another language', () => {
    const spanish = { ...labels, quote: 'Cita' };
    expect(filterSlashCommands('cit', spanish).map((c) => c.id)).toEqual(['quote']);
  });
});

describe('applySlashCommand', () => {
  const run = (text: string, caret: number, id: string) => {
    const context = slashContext(text, caret);
    if (!context) throw new Error('no context');
    return applySlashCommand(text, context, caret, find(id));
  };

  it('replaces the typed /query with the block', () => {
    expect(run('/head', 5, 'h2').text).toBe('## ');
    expect(run('/', 1, 'bullets').text).toBe('- ');
    expect(run('/todo', 5, 'tasks').text).toBe('- [ ] ');
  });

  it('only changes the line it is on and keeps the rest', () => {
    const edit = run('first\n/q\nlast', 8, 'quote');
    expect(edit.text).toBe('first\n> \nlast');
  });

  it('puts the caret where typing continues', () => {
    const edit = run('/h1', 3, 'h1');
    expect(edit.selection).toEqual({ start: 2, end: 2 });
  });

  it('inserts a divider and moves past it', () => {
    const edit = run('above\n/div', 10, 'divider');
    expect(edit.text).toBe('above\n---\n');
    expect(edit.selection).toEqual({ start: 10, end: 10 });
  });

  it('opens a fenced block with the caret inside it', () => {
    const edit = run('/code', 5, 'code');
    expect(edit.text).toBe('```\n\n```');
    expect(edit.selection).toEqual({ start: 4, end: 4 });
  });

  it('replaces a block marker the line already had instead of stacking', () => {
    expect(run('- item /h1', 10, 'h1').text).toBe('# item ');
  });

  it('keeps text that followed a mid-line slash', () => {
    const edit = run('note /bul', 9, 'bullets');
    expect(edit.text).toBe('- note ');
  });
});
