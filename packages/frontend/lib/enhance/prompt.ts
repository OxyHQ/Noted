/**
 * What the model is asked, and how a meeting is made to fit.
 *
 * A phone-sized model has a small context window, and a two-hour meeting does
 * not fit in it. Truncating loses whatever was said in the part thrown away —
 * and the end of a meeting is usually where the decisions are, so truncating the
 * end is the worst possible choice while looking like the obvious one.
 *
 * So a long transcript is read in windows and the answers are combined. Each
 * window is a complete request the model can answer well, and nothing is
 * silently dropped.
 */

import type { Enhancement } from '@/lib/enhance/contract';

/**
 * Characters of transcript per request.
 *
 * Conservative on purpose: this is a budget in characters for a limit that is
 * really in tokens, and Spanish runs longer per token than English. Overshooting
 * means the model silently drops the beginning of its own prompt, which looks
 * like a bad summary rather than a full context window.
 */
export const DEFAULT_WINDOW_CHARS = 6_000;

export interface TranscriptLine {
  atMs: number;
  text: string;
}

/**
 * Split a transcript into windows that each fit the budget.
 *
 * Never splits a line: half a sentence at a window edge is a sentence the model
 * will misread in both windows. A single line longer than the budget gets a
 * window to itself rather than being cut.
 */
export function splitForContext(
  transcript: readonly TranscriptLine[],
  budget = DEFAULT_WINDOW_CHARS,
): TranscriptLine[][] {
  const windows: TranscriptLine[][] = [];
  let current: TranscriptLine[] = [];
  let size = 0;

  for (const line of transcript) {
    const cost = line.text.length + 1;
    if (current.length > 0 && size + cost > budget) {
      windows.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += cost;
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

function timestamp(atMs: number): string {
  const totalSeconds = Math.floor(atMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export interface PromptOptions {
  /** What the user wrote themselves, so the model adds rather than repeats. */
  existingBody?: string;
  /** BCP-47-ish code, or `auto` to answer in the language of the meeting. */
  language: string;
  /** True when this is one window of several, so the model does not conclude. */
  isPartial?: boolean;
}

/**
 * Build the request.
 *
 * The instruction that matters most is the one telling the model it may return
 * nothing: a meeting where little was decided should produce a short note, and a
 * model that feels obliged to fill five sections will invent four of them. An
 * invented action item is worse than a missing one — the user acts on it.
 */
export function buildPrompt(window: readonly TranscriptLine[], options: PromptOptions): string {
  const lines = window.map((line) => `[${timestamp(line.atMs)}] ${line.text}`).join('\n');

  const language =
    options.language === 'auto'
      ? 'Answer in the language the meeting is in.'
      : `Answer in ${options.language}.`;

  const scope = options.isPartial
    ? 'This is one part of a longer meeting. Cover only what this part contains; do not summarise the meeting as a whole.'
    : 'This is the whole meeting.';

  const existing = options.existingBody?.trim();
  const alreadyWritten = existing
    ? `\nThe person took these notes themselves. Do not repeat them; add only what they did not write:\n"""\n${existing}\n"""\n`
    : '';

  return `You are taking notes on a meeting from its transcript.

Write down only what someone would want to read again. If nothing in a category came up, return an empty list for it — an empty list is a good answer, and inventing an item is worse than leaving it out. Never write an action item nobody agreed to.

${scope}
${language}
${alreadyWritten}
Reply with JSON only, in this shape, and nothing else:
{"title": "", "summary": [], "decisions": [], "actions": [], "questions": []}

- title: what this meeting was about, a few words.
- summary: the points worth reading again.
- decisions: what was settled.
- actions: what someone agreed to do, naming who if it was said.
- questions: what was raised and left open.

Transcript:
${lines}`;
}

/**
 * Combine the answers from several windows into one note.
 *
 * Order is preserved because a meeting has one, and repeats are dropped because
 * the same decision restated in two windows is one decision. The title comes
 * from the first window that produced one: the beginning of a meeting is where
 * people say what it is about.
 */
export function mergeEnhancements(parts: readonly Enhancement[]): Enhancement | null {
  const merged: Enhancement = {
    title: '',
    summary: [],
    decisions: [],
    actions: [],
    questions: [],
  };

  for (const part of parts) {
    if (merged.title === '' && part.title !== '') merged.title = part.title;
    for (const field of ['summary', 'decisions', 'actions', 'questions'] as const) {
      for (const line of part[field]) {
        const isRepeat = merged[field].some(
          (existing) => existing.toLowerCase() === line.toLowerCase(),
        );
        if (!isRepeat) merged[field].push(line);
      }
    }
  }

  const hasContent =
    merged.summary.length > 0 ||
    merged.decisions.length > 0 ||
    merged.actions.length > 0 ||
    merged.questions.length > 0;

  return hasContent ? merged : null;
}
