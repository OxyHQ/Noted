import { describe, expect, it } from 'vitest';
import {
  insertLink,
  insertTable,
  moveLines,
  toggleCodeBlock,
  toggleHeading,
  toggleLinePrefix,
  toggleNumberedList,
  toggleWrap,
} from '@/lib/markdown/commands';

const sel = (start: number, end = start) => ({ start, end });
/** The selected text after an edit, which is what a person sees highlighted. */
const picked = (edit: { text: string; selection: { start: number; end: number } }) =>
  edit.text.slice(edit.selection.start, edit.selection.end);

describe('toggleWrap', () => {
  it('wraps the selection and keeps it selected', () => {
    const edit = toggleWrap('make this loud', sel(5, 9), '**');
    expect(edit.text).toBe('make **this** loud');
    expect(picked(edit)).toBe('this');
  });

  it('takes the marker off when it sits just outside the selection', () => {
    const edit = toggleWrap('make **this** loud', sel(7, 11), '**');
    expect(edit.text).toBe('make this loud');
    expect(picked(edit)).toBe('this');
  });

  it('takes the marker off when the whole marked text is selected', () => {
    const edit = toggleWrap('make **this** loud', sel(5, 13), '**');
    expect(edit.text).toBe('make this loud');
    expect(picked(edit)).toBe('this');
  });

  it('inserts a pair and parks the caret between them on an empty selection', () => {
    const edit = toggleWrap('ab', sel(1), '*');
    expect(edit.text).toBe('a**b');
    expect(edit.selection).toEqual({ start: 2, end: 2 });
  });

  it('is its own inverse', () => {
    const once = toggleWrap('word', sel(0, 4), '~~');
    const twice = toggleWrap(once.text, once.selection, '~~');
    expect(twice.text).toBe('word');
  });

  it('does not mistake a longer marker for a shorter one', () => {
    // `*` around text that is already `**bold**` must wrap again, not unwrap.
    const edit = toggleWrap('**bold**', sel(2, 6), '*');
    expect(edit.text).toBe('***bold***');
  });

  it('can take italic off bold-italic and bold off bold-italic, leaving the other', () => {
    expect(toggleWrap('***x***', sel(3, 4), '*').text).toBe('**x**');
    expect(toggleWrap('***x***', sel(3, 4), '**').text).toBe('*x*');
    // …and the same when the whole marked text is the selection.
    expect(toggleWrap('***x***', sel(0, 7), '*').text).toBe('**x**');
  });

  it('does not take italic off when only bold is on, selected whole', () => {
    expect(toggleWrap('**x**', sel(0, 5), '*').text).toBe('***x***');
  });

  it('clamps a selection that points past the end', () => {
    expect(toggleWrap('hi', sel(10, 20), '`').text).toBe('hi``');
  });
});

describe('insertLink', () => {
  it('links the selected text and selects it', () => {
    const edit = insertLink('see docs here', sel(4, 8), 'https://x.test');
    expect(edit.text).toBe('see [docs](https://x.test) here');
    expect(picked(edit)).toBe('docs');
  });

  it('uses the address as the text when nothing is selected', () => {
    const edit = insertLink('', sel(0), 'https://x.test');
    expect(edit.text).toBe('[https://x.test](https://x.test)');
  });
});

describe('toggleLinePrefix', () => {
  it('prefixes the line the caret is on', () => {
    const edit = toggleLinePrefix('one\ntwo\nthree', sel(5), '- ');
    expect(edit.text).toBe('one\n- two\nthree');
  });

  it('prefixes every selected line and removes the prefix when all have it', () => {
    const on = toggleLinePrefix('a\nb\nc', sel(0, 5), '- ');
    expect(on.text).toBe('- a\n- b\n- c');
    expect(toggleLinePrefix(on.text, on.selection, '- ').text).toBe('a\nb\nc');
  });

  it('replaces another block marker instead of stacking it', () => {
    expect(toggleLinePrefix('- item', sel(0), '> ').text).toBe('> item');
    expect(toggleLinePrefix('## title', sel(0), '- ').text).toBe('- title');
    expect(toggleLinePrefix('- [ ] task', sel(0), '> ').text).toBe('> task');
  });

  it('leaves blank lines alone', () => {
    expect(toggleLinePrefix('a\n\nb', sel(0, 4), '> ').text).toBe('> a\n\n> b');
  });

  it('does not touch the line a selection merely ends at the start of', () => {
    const edit = toggleLinePrefix('a\nb', sel(0, 2), '- ');
    expect(edit.text).toBe('- a\nb');
  });

  it('keeps the selection on the same words', () => {
    const edit = toggleLinePrefix('hello world', sel(6, 11), '- ');
    expect(picked(edit)).toBe('world');
  });

  it('works on a task prefix', () => {
    expect(toggleLinePrefix('buy milk', sel(0), '- [ ] ').text).toBe('- [ ] buy milk');
  });
});

describe('toggleNumberedList', () => {
  it('numbers the lines in order and removes the numbers again', () => {
    const on = toggleNumberedList('a\nb\nc', sel(0, 5));
    expect(on.text).toBe('1. a\n2. b\n3. c');
    expect(toggleNumberedList(on.text, on.selection).text).toBe('a\nb\nc');
  });

  it('replaces bullets rather than numbering a bullet', () => {
    expect(toggleNumberedList('- a\n- b', sel(0, 7)).text).toBe('1. a\n2. b');
  });

  it('does not count blank lines', () => {
    expect(toggleNumberedList('a\n\nb', sel(0, 4)).text).toBe('1. a\n\n2. b');
  });
});

describe('toggleHeading', () => {
  it('sets, switches and clears a heading level', () => {
    const h2 = toggleHeading('Title', sel(0), 2);
    expect(h2.text).toBe('## Title');
    expect(toggleHeading(h2.text, h2.selection, 3).text).toBe('### Title');
    expect(toggleHeading(h2.text, h2.selection, 2).text).toBe('Title');
  });

  it('clamps the level to 1–6', () => {
    expect(toggleHeading('x', sel(0), 0).text).toBe('# x');
    expect(toggleHeading('x', sel(0), 9).text).toBe('###### x');
  });
});

describe('toggleCodeBlock', () => {
  it('fences the selected lines and unfences them again', () => {
    const on = toggleCodeBlock('before\nlet x = 1\nafter', sel(7, 16));
    expect(on.text).toBe('before\n```\nlet x = 1\n```\nafter');
    expect(picked(on)).toBe('let x = 1');

    const block = toggleCodeBlock('```\nlet x = 1\n```', sel(0, 17));
    expect(block.text).toBe('let x = 1');
  });
});

describe('insertTable', () => {
  const TABLE = '| A | B | C |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |';

  it('takes the place of an empty line and selects the first header', () => {
    const edit = insertTable('', sel(0));
    expect(edit.text).toBe(TABLE);
    expect(picked(edit)).toBe('A');
  });

  it('goes below a line with text, after a blank line', () => {
    const edit = insertTable('intro', sel(5));
    expect(edit.text).toBe(`intro\n\n${TABLE}`);
    expect(picked(edit)).toBe('A');
  });

  it('keeps following text apart from the table', () => {
    const edit = insertTable('top\n\nafter', sel(0));
    expect(edit.text).toBe(`top\n\n${TABLE}\n\nafter`);
  });

  it('replaces only the empty line the caret is on', () => {
    const edit = insertTable('one\n\ntwo', sel(4));
    expect(edit.text).toBe(`one\n${TABLE}\n\ntwo`);
  });

  it('takes custom headers and row count', () => {
    const edit = insertTable('', sel(0), { headers: ['Name', 'Qty'], rows: 1 });
    expect(edit.text).toBe('| Name | Qty |\n| --- | --- |\n|  |  |');
    expect(picked(edit)).toBe('Name');
  });
});

describe('moveLines', () => {
  it('swaps the line with the one above and keeps the caret on it', () => {
    const edit = moveLines('one\ntwo\nthree', sel(5), 'up');
    expect(edit.text).toBe('two\none\nthree');
    expect(edit.selection).toEqual({ start: 1, end: 1 });
  });

  it('swaps the line with the one below and keeps the caret on it', () => {
    const edit = moveLines('one\ntwo\nthree', sel(1), 'down');
    expect(edit.text).toBe('two\none\nthree');
    expect(edit.selection).toEqual({ start: 5, end: 5 });
  });

  it('moves every selected line together and keeps them selected', () => {
    const edit = moveLines('a\nb\nc\nd', sel(2, 5), 'up');
    expect(edit.text).toBe('b\nc\na\nd');
    expect(picked(edit)).toBe('b\nc');
  });

  it('can be repeated to travel across the whole text', () => {
    let edit = moveLines('a\nb\nc', sel(0), 'down');
    edit = moveLines(edit.text, edit.selection, 'down');
    expect(edit.text).toBe('b\nc\na');
  });

  it('does nothing at the top or the bottom', () => {
    expect(moveLines('a\nb', sel(0), 'up').text).toBe('a\nb');
    expect(moveLines('a\nb', sel(3), 'down').text).toBe('a\nb');
    expect(moveLines('only', sel(2), 'down').text).toBe('only');
  });

  it('moves past a blank line like any other', () => {
    expect(moveLines('a\n\nb', sel(0), 'down').text).toBe('\na\nb');
  });

  it('is its own inverse', () => {
    const down = moveLines('x\ny\nz', sel(0), 'down');
    expect(moveLines(down.text, down.selection, 'up').text).toBe('x\ny\nz');
  });
});
