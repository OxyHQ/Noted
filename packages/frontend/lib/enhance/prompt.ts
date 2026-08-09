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

import type { Enhancement } from "@/lib/enhance/contract";

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
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
export function buildPrompt(
  window: readonly TranscriptLine[],
  options: PromptOptions,
): string {
  const lines = window
    .map((line) => `[${timestamp(line.atMs)}] ${line.text}`)
    .join("\n");

  const language =
    options.language === "auto"
      ? "Write in the language primarily used in the conversation."
      : `Write in ${options.language}.`;

  const scope = options.isPartial
    ? "This is part of a longer conversation. Take notes only from what is contained here."
    : "This is the full conversation.";

  const existing = options.existingBody?.trim();
  const alreadyWritten = existing
    ? `
The user has already written these notes:
"""
${existing}
"""
Do not repeat them. Add only useful information that is still missing.
`
    : "";

  return `Act as an excellent human note-taker listening to this conversation.

Write the notes a person would naturally take if they wanted to understand and remember the important information later.

Capture useful information, explanations, ideas, conclusions, context, examples, numbers, plans and important details. Turn conversational exchanges into clear notes instead of reproducing the conversation.

Do not write down questions that were answered. Capture the useful answer instead.
Only include an open question when something important was genuinely left unresolved.
Only create an action when someone actually committed to or was assigned a next step.

Ignore greetings, filler, repetition, small talk and unimportant details.
Do not invent or infer information that was not said.
Prefer concise but informative notes rather than a summary of the conversation.

${scope}
${language}
${alreadyWritten}

Return valid JSON only:
{"title":"","notes":[],"actions":[],"openQuestions":[]}

title: a short specific title for what is being discussed.
notes: the actual notes someone would want to keep and study or refer back to later.
actions: concrete agreed or assigned next steps, including who when known.
openQuestions: important unresolved matters only, never questions that were answered.

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
export function mergeEnhancements(
  parts: readonly Enhancement[],
): Enhancement | null {
  const merged: Enhancement = {
    title: "",
    notes: [],
    actions: [],
    openQuestions: [],
  };

  for (const part of parts) {
    if (merged.title === "" && part.title !== "") merged.title = part.title;
    for (const field of ["notes", "actions", "openQuestions"] as const) {
      for (const line of part[field]) {
        const isRepeat = merged[field].some(
          (existing) => existing.toLowerCase() === line.toLowerCase(),
        );
        if (!isRepeat) merged[field].push(line);
      }
    }
  }

  const hasContent =
    merged.notes.length > 0 || merged.actions.length > 0 || merged.openQuestions.length > 0;

  return hasContent ? merged : null;
}
