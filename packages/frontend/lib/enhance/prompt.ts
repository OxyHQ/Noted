/**
 * What the model is asked, and how a meeting is made to fit.
 *
 * ## One core, plus a fragment per profile
 *
 * A lecture, a stand-up and a dictated shopping list want different notes, and
 * the tempting way to serve all three is a prompt per profile. Six copies of a
 * long instruction drift the moment one of them is improved, and the drift is
 * invisible — every copy still produces plausible output. So there is one core
 * that states what a note IS, and a short fragment per profile that says what
 * matters in that situation. A fragment never repeats the core.
 *
 * ## Why the transcript is numbered
 *
 * A model writes fluent prose, which is what makes it dangerous: an invented
 * claim reads better than a real one. Numbering the lines lets it say which ones
 * each note came from, cheaply — a small model handles `[3, 4]` far better than a
 * list of segment ids — and the caller checks those numbers against the lines it
 * actually sent.
 *
 * ## Windows
 *
 * A phone-sized model has a small context window and a two-hour meeting does not
 * fit in it. Truncating loses whatever was in the part thrown away, and the end
 * of a meeting is usually where the decisions are — so truncating the end is the
 * worst possible choice while looking like the obvious one. A long transcript is
 * read in windows instead, and nothing is silently dropped.
 */

import type { CaptureProfile, DocumentIntent, PendingExpansion } from '@noted/shared-types';
import type { EnhanceLine } from '@/lib/enhance/contract';
import { describeSchema, FIELDS } from '@/lib/enhance/schema';

/**
 * Characters of transcript per request.
 *
 * Conservative on purpose: this is a budget in characters for a limit that is
 * really in tokens, and Spanish runs longer per token than English. Overshooting
 * means the model silently drops the beginning of its own prompt, which looks
 * like a bad summary rather than a full context window.
 */
export const DEFAULT_WINDOW_CHARS = 6_000;

/**
 * Split a transcript into windows that each fit the budget.
 *
 * Never splits a line: half a sentence at a window edge is a sentence the model
 * will misread in both windows. A single line longer than the budget gets a
 * window to itself rather than being cut.
 */
export function splitForContext(
  transcript: readonly EnhanceLine[],
  budget = DEFAULT_WINDOW_CHARS,
): EnhanceLine[][] {
  const windows: EnhanceLine[][] = [];
  let current: EnhanceLine[] = [];
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

/**
 * What a note is, whatever kind of recording produced it.
 *
 * The instruction that matters most is the one telling the model it may return
 * nothing: a meeting where little was decided should produce a short note, and a
 * model that feels obliged to fill four sections will invent three of them. An
 * invented action item is worse than a missing one — the user acts on it.
 */
export const CORE_INSTRUCTIONS = `Act as an excellent human note-taker listening to this recording.

Write a DOCUMENT about what was said — the notes an attentive person would write while listening — not a list of the sentences they heard.

Organize it by subject, with a heading for each. Use paragraphs for connected reasoning and explanation. Use a bullet list only for genuinely list-shaped information, and a numbered list only for an ordered process.

Capture meaning, not the shape of the conversation: explanations, concepts, context, examples, numbers and conclusions.
Turn an answered question into the useful answer. Keep a question only when something important was genuinely left unresolved; a question the speaker asked and then answered is not one.
Create an action only when someone committed to one, was assigned one, or asked you to write one down.
Ignore greetings, filler, repetition and small talk.
Every list may be empty. An empty list is a real answer; inventing something to fill it is not.
Use only what the transcript says. Do not add knowledge of your own.

WRITE ABOUT THE SPEAKER, NOT AS THEM.
The transcript is somebody talking, so it is full of "I", "we" and "my". Your notes are written about that person, so they are not.
Use a person's name when the transcript states it. Otherwise use a role the transcript states. Otherwise say "the speaker", "the lecturer", "the interviewer" or "the participant", in the language of the note.
Never invent a name, a role, a gender or an organization. If the recording does not say who this is, do not say.
Keep first person only inside a "quote" block, where it is explicitly somebody's own words, or when the speaker is dictating a note for themselves.
In a meeting, prefer "the team", a participant's stated name, or impersonal wording. Do not guess who said what.

Mark anything you are unsure of — a proper noun you could not make out, a figure you are not certain of — rather than stating it confidently.`;

/**
 * What matters in each situation.
 *
 * Short by construction: a fragment that restated the core would be a second
 * copy of it, and the two would drift. `auto` adds nothing at all — a recording
 * nobody classified gets the core, which is a complete instruction.
 */
export const PROFILE_INSTRUCTIONS: Readonly<Record<CaptureProfile, string>> = {
  // Not empty any more. A recording nobody classified still deserves a document
  // rather than an undifferentiated list — "no profile" was being read as "no
  // instruction about form", which is how `auto` produced the worst notes.
  auto: 'Organize the note by subject, with headings and paragraphs. A recording nobody classified is still a document, never one long list.',
  meeting:
    'This is a meeting. Keep decisions and their latest status, owners and deadlines, and blockers that are still open. Do not repeat a decision as both a note and an action.',
  lecture:
    'This is a class. Give each concept its own section: the definition, the explanation, the examples, and how it relates to the rest. Keep formulas, dates, names and figures. A class usually has no actions and no decisions; leave those empty.',
  event:
    'This is a talk or an event. Record who is speaking in "people" when the recording says — a stated role counts, an invented name does not. Give each argument its own section with a heading, keep the evidence and examples they used, and finish with what is worth taking away. An event usually has no actions; leave them empty.',
  brainstorm:
    'This is a brainstorm. Keep the ideas, the alternatives and the reasoning, with advantages, disadvantages and constraints. Record a decision only if the group actually settled one.',
  interview:
    'This is an interview. Keep the useful answers grouped by topic, with facts, stories and claims worth following up. Do not reproduce it as a question-and-answer transcript.',
  dictation:
    'The speaker is dictating a list rather than discussing something. Put what they asked for in listAdditions, one entry per thing. Keep notes, actions and openQuestions empty unless they also said something that belongs there.',
};

/**
 * The one thing that lets the model contribute knowledge of its own.
 *
 * Empty almost always, and that is the point: ordinary discussion may only be
 * reported. "Hablamos de hacer una pizza" is not permission. Each authorisation
 * is named, so an item the model adds can be traced back to the sentence that
 * allowed it — and anything it adds outside these subjects is refused by the
 * caller rather than argued with.
 */
export function expansionInstructions(expansions: readonly PendingExpansion[]): string {
  if (expansions.length === 0) return '';
  const subjects = expansions.map((expansion) => `- ${expansion.subject}`).join('\n');
  return `
The speaker explicitly asked you to complete the following, so for these — and ONLY these — you may add standard items that were not said out loud:
${subjects}

Put each added item in ${FIELDS.listAdditions} like this, and add nothing for any other subject:
{ "${FIELDS.text}": "", "${FIELDS.derived}": { "subject": "", "reason": "" } }`;
}

export interface PromptOptions {
  /** What the user wrote themselves, so the model adds rather than repeats. */
  existingBody?: string;
  /** BCP-47-ish code, or `auto` to answer in the language of the recording. */
  language: string;
  profile: CaptureProfile;
  intent: DocumentIntent;
  expansions: readonly PendingExpansion[];
  /** True when this is one window of several, so the model does not conclude. */
  isPartial?: boolean;
}

export function buildPrompt(window: readonly EnhanceLine[], options: PromptOptions): string {
  // Numbered from one, because a model asked for "line 0" reliably answers with
  // the first line anyway and then everything is off by one.
  const lines = window
    .map((line, index) => `${String(index + 1)}. [${timestamp(line.atMs)}] ${line.text}`)
    .join('\n');

  const language =
    options.language === 'auto'
      ? 'Write in the language primarily used in the recording.'
      : `Write in ${options.language}.`;

  const scope = options.isPartial
    ? 'This is part of a longer recording. Take notes only from what is contained here.'
    : 'This is the whole recording.';

  const existing = options.existingBody?.trim();
  const alreadyWritten = existing
    ? `
The user has already written these notes:
"""
${existing}
"""
Do not repeat them. Add only useful information that is still missing.
`
    : '';

  return [
    CORE_INSTRUCTIONS,
    PROFILE_INSTRUCTIONS[options.profile],
    expansionInstructions(options.expansions),
    scope,
    language,
    alreadyWritten,
    describeSchema(),
    `Transcript:\n${lines}`,
  ]
    .filter((part) => part.trim() !== '')
    .join('\n\n');
}
