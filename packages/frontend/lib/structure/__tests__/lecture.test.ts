/**
 * The case the structurer was getting wrong: a talk, not a meeting.
 *
 * Reported from a real recording. The note that came out was, in full:
 *
 * > ## Open questions
 * > - When you send a message to an AI, there's a moment where it appears to be
 * >   thinking, what's actually happening?
 * > - Is it reading the entire internet?
 * > - Is it copying answers from a database?
 * > - Is it just a fancier search engine?
 *
 * Every one of those is the speaker introducing a topic and answering it a
 * sentence later, and not one word of what they actually explained is in the
 * note. Two separate faults meet there: the body rendered only decisions and
 * questions, so a talk that produces neither produced nothing; and a question
 * mark was taken to mean a question nobody had answered.
 *
 * The fixture below is written in the shape of that recording — rhetorical
 * question, then the answer, no tasks, no decisions — because that shape is the
 * thing being tested. A meeting fixture cannot fail this way.
 */

import { describe, expect, it } from 'vitest';

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import { structureTranscript } from '@/lib/structure/structure';

const startedAt = new Date('2026-03-04T10:00:00.000Z');
const makeId = (): string => 'id';

/** Consecutive speech: no gap long enough to break a paragraph on its own. */
function talk(lines: readonly string[]): TranscriptSegment[] {
  return lines.map((text, index) => ({
    id: `c1#0.${String(index)}`,
    captureId: 'c1',
    sliceIndex: 0,
    segmentIndex: index,
    revision: 0,
    startMs: index * 6_000,
    endMs: index * 6_000 + 5_500,
    text,
    confidence: null,
    speakerHint: null,
    isFinal: true,
  }));
}

const LECTURE = talk([
  'When you send a message to an AI, there is a moment where it appears to be thinking, what is actually happening?',
  'It is predicting the next word, one word at a time, using the pattern it learned during training.',
  'Is it reading the entire internet?',
  'No, the model read the internet once during training and never looks at it again while answering you.',
  'Is it copying answers from a database?',
  'There is no database of answers in the model, only the weights left over from training.',
  'Is it just a fancier search engine?',
  'A search engine finds a page that already exists, and a language model writes a sentence that has never existed.',
]);

describe('a recorded talk', () => {
  const note = structureTranscript(LECTURE, { startedAt, makeId });

  it('writes down what was explained', () => {
    // The whole failure was a note with the content missing.
    expect(note.markdown).not.toBe('');
    expect(note.markdown).toContain('predicting the next word');
  });

  it('does not file a question the speaker answered as an open one', () => {
    expect(note.markdown).not.toContain('## Open questions');
    expect(note.markdown).not.toContain('Is it copying answers from a database?');
  });

  it('has no empty headings, because a talk decides nothing', () => {
    expect(note.markdown).not.toContain('## Decisions');
    expect(note.checklist).toEqual([]);
  });

  it('does not simply reproduce the transcript', () => {
    // A note that keeps every sentence is a transcript with bullets, and reading
    // it back is the work the app exists to save.
    const bullets = note.markdown.split('\n').filter((line) => line.startsWith('- '));
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThan(LECTURE.length);
  });

  it('still reports a question nobody got to', () => {
    // The other side of the rule, so "answered" is not being read as "always
    // drop the questions". A question left hanging at the end is open.
    const hanging = structureTranscript(
      talk([
        'The model writes a sentence that has never existed before.',
        'That is the part people find hard to accept, and it is the honest description.',
        'So what happens when two of them are asked the same question at once?',
      ]),
      { startedAt, makeId },
    );
    expect(hanging.markdown).toContain('## Open questions');
    expect(hanging.markdown).toContain('what happens when two of them are asked');
  });
});
