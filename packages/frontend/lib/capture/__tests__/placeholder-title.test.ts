import { describe, expect, it } from 'vitest';

import {
  isPlaceholderTitle,
  placeholderTitle,
  userTitleOf,
  userAuthoredPart,
} from '@/lib/capture/placeholder-title';

const STARTED_AT = new Date('2026-08-09T21:39:40.000Z');

describe('placeholder titles', () => {
  it('recognises the title it generated', () => {
    expect(isPlaceholderTitle(placeholderTitle(STARTED_AT), STARTED_AT)).toBe(true);
  });

  it('hands writers an empty title where the placeholder still stands', () => {
    // The bug this exists for: the note is created with the start time in the
    // title field, and everything downstream refuses to touch a title. Left
    // indistinguishable from the user's, the date outlived every attempt to name
    // the note — the model's title never won once.
    expect(userTitleOf(placeholderTitle(STARTED_AT), STARTED_AT)).toBe('');
  });

  it('protects a title the user typed', () => {
    expect(isPlaceholderTitle('Presupuesto Q3', STARTED_AT)).toBe(false);
    expect(userTitleOf('Presupuesto Q3', STARTED_AT)).toBe('Presupuesto Q3');
  });

  it('protects a user title that also looks like a date', () => {
    // Someone who types a date has chosen it. Only the exact value generated
    // from this recording's own start time counts as the placeholder.
    const otherDate = new Date('2020-01-02T03:04:05.000Z').toLocaleString();
    expect(isPlaceholderTitle(otherDate, STARTED_AT)).toBe(false);
    expect(userTitleOf(otherDate, STARTED_AT)).toBe(otherDate);
  });

  it('still recognises the placeholder around incidental whitespace', () => {
    expect(isPlaceholderTitle(` ${placeholderTitle(STARTED_AT)} `, STARTED_AT)).toBe(true);
  });

  it('treats an absent title as nothing to protect', () => {
    expect(userTitleOf('', STARTED_AT)).toBe('');
  });
});

describe('userAuthoredPart', () => {
  const note = {
    title: placeholderTitle(STARTED_AT),
    body: 'lo que escribí',
    checklist: [{ id: 'a', text: 'una tarea', checked: true }],
  };

  it('drops the placeholder while keeping everything the user wrote', () => {
    // The single description of "what the user contributed", so a writer cannot
    // be handed the raw title by accident at one call site and not the other.
    expect(userAuthoredPart(note, STARTED_AT)).toEqual({
      title: '',
      body: 'lo que escribí',
      checklist: [{ id: 'a', text: 'una tarea', checked: true }],
    });
  });

  it('keeps a title the user chose', () => {
    expect(userAuthoredPart({ ...note, title: 'Mi título' }, STARTED_AT).title).toBe('Mi título');
  });
});
