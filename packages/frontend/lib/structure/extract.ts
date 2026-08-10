/**
 * Finding the parts of a conversation worth pulling out of it.
 *
 * Rules, not a model: this runs on every device with nothing downloaded, which
 * is what makes the feature work the same on a cheap Android as on a new iPhone.
 *
 * **Precision over recall, deliberately.** A missed task is a line the user can
 * still read three centimetres away in the transcript. An invented one is a
 * commitment nobody made, in a note they will trust. So every pattern below
 * requires an explicit marker of intent, and none of them guess from tone.
 */

export type HighlightKind = 'action' | 'decision' | 'question';

export interface Highlight {
  kind: HighlightKind;
  /** The sentence as it appears in the cleaned transcript. */
  text: string;
  /** Where it was said, for the reader to go and check. */
  atMs: number;
}

/**
 * Split a block into sentences.
 *
 * Kept simple on purpose. An abbreviation ("aprox.", "etc.") splits a sentence
 * in two, which costs a slightly short line — where a cleverer rule that merged
 * too eagerly would join two separate commitments into one item.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Commitments. Every pattern names someone taking something on, or an explicit
 * to-do marker.
 *
 * `vamos a` is NOT here and belongs to decisions: "vamos a hacerlo así" settles a
 * question rather than assigning work.
 */
const ACTION_PATTERNS: readonly RegExp[] = [
  // Spanish — obligation and assignment
  /\b(?:hay que|tenemos que|tengo que|tienes que|tiene que|tenéis que|tienen que)\b/i,
  /\b(?:me encargo|te encargas|se encarga|nos encargamos)\b/i,
  /\b(?:quedamos en|queda pendiente|pendiente de)\b/i,
  // `habría que` is NOT here, and the difference is the conditional. "Hay que
  // avisar" and "habrá que avisar" are somebody saying it will be done;
  // "habría que verlo con calma" is somebody floating an idea, and the sentence
  // after it is usually "de momento lo dejamos ahí". Measured on the evaluation
  // corpus: it was the one construction turning a discarded suggestion into a
  // task. The cost is stated rather than hidden — a meeting where "habría que
  // avisar" is then agreed to loses that task from the checklist, and it stays
  // in the transcript where the reader can still find it.
  /\b(?:hace falta|habrá que)\b/i,
  // English — obligation and assignment
  /\b(?:we need to|i need to|you need to|we have to|i have to|you have to)\b/i,
  /\b(?:i'?ll|we'?ll|you'?ll)\s+(?:take|handle|send|write|check|do|look|follow)\b/i,
  // `to-do` only with the hyphen. Bare `todo` is one of the most common words in
  // Spanish ("todo el mundo", "todo bien"), so matching it would turn ordinary
  // sentences into commitments in exactly the language this app is used in.
  /\b(?:action item|to-do|follow[- ]up)\b/i,
  /\b(?:let'?s make sure|make sure to|remember to)\b/i,
];

/** Settled points. These record what was agreed, not what will be done. */
const DECISION_PATTERNS: readonly RegExp[] = [
  /\b(?:decidimos|hemos decidido|acordamos|hemos acordado|queda decidido)\b/i,
  /\b(?:vamos a|al final)\b.*\b(?:hacer|usar|ir|optar|elegir|dejar)\b/i,
  /\b(?:we decided|we agreed|we'?ve agreed|the decision is|we'?re going with)\b/i,
  /\b(?:let'?s go with|we'?ll use)\b/i,
];

/** A question is punctuation, not a keyword. */
function isQuestion(sentence: string): boolean {
  return sentence.endsWith('?') || sentence.startsWith('¿');
}

/** The shortest sentence worth keeping — below this it carries no information. */
const MIN_HIGHLIGHT_CHARS = 12;

function matchesAny(sentence: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(sentence));
}

/**
 * Classify one sentence, or decide it is ordinary conversation.
 *
 * Order is the whole rule:
 *
 * 1. **A question is a question, whatever else it contains.** "¿Quién se encarga
 *    del diseño?" carries a commitment marker but is the opposite of a
 *    commitment — it is the record that nobody has taken it on. Classified as an
 *    action it becomes a task with no owner that nobody agreed to, which is
 *    precisely the invented commitment this module refuses to produce.
 * 2. **Then the commitment**, when a sentence reads as both a decision and one
 *    ("acordamos que hay que enviarlo"): the commitment is the useful reading,
 *    because it is the one that becomes something to tick off.
 * 3. Then the decision.
 */
export function classifySentence(sentence: string): HighlightKind | null {
  if (sentence.length < MIN_HIGHLIGHT_CHARS) return null;
  if (isQuestion(sentence)) return 'question';
  if (matchesAny(sentence, ACTION_PATTERNS)) return 'action';
  if (matchesAny(sentence, DECISION_PATTERNS)) return 'decision';
  return null;
}

/** Pull every highlight out of one block of cleaned speech. */
export function extractHighlights(text: string, blockStartMs: number): Highlight[] {
  const highlights: Highlight[] = [];
  for (const sentence of splitSentences(text)) {
    const kind = classifySentence(sentence);
    if (kind) highlights.push({ kind, text: sentence, atMs: blockStartMs });
  }
  return highlights;
}

/**
 * How far the conversation gets to move on before a question stops counting as
 * open.
 */
export const ANSWERED_WITHIN_SENTENCES = 6;

/**
 * The questions nobody came back to.
 *
 * A question mark alone is not an open question, and treating it as one is what
 * turned a recorded talk into nothing but a list of the speaker's own rhetorical
 * questions — every one of which they answered in the next breath:
 *
 * > - Is it reading the entire internet?
 * > - Is it copying answers from a database?
 * > - Is it just a fancier search engine?
 *
 * So a question that the talk moves past is not listed. What survives is a
 * question left hanging: the last thing said, or followed only by more
 * questions.
 *
 * This trades recall for precision in the opposite direction from the rest of
 * this module, and deliberately: a question that was in fact answered has its
 * answer in the note's own points, so nothing is lost by not also filing it as
 * an open one — while a section that lists every question the speaker used to
 * introduce a topic is noise that buries the real one.
 *
 * It needs the whole ordered stream rather than one block, because the sentence
 * that settles a question is routinely in the block after it.
 */
export function selectOpenQuestions(
  blocks: readonly { text: string; startMs: number }[],
): Highlight[] {
  const stream = blocks.flatMap((block) =>
    splitSentences(block.text).map((sentence) => ({ sentence, atMs: block.startMs })),
  );

  const open: Highlight[] = [];
  stream.forEach((entry, index) => {
    if (entry.sentence.length < MIN_HIGHLIGHT_CHARS || !isQuestion(entry.sentence)) return;
    const movedOn = stream
      .slice(index + 1, index + 1 + ANSWERED_WITHIN_SENTENCES)
      .some((later) => !isQuestion(later.sentence));
    if (!movedOn) open.push({ kind: 'question', text: entry.sentence, atMs: entry.atMs });
  });
  return open;
}
