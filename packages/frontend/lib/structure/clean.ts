/**
 * Making transcribed speech readable.
 *
 * Speech is not prose. People restart sentences, stall with filler, and repeat
 * themselves; a recogniser writes all of it down faithfully. Removing that is
 * what separates a transcript from a note.
 *
 * The rule throughout: only remove what carries no meaning. Anything ambiguous
 * stays, because a note that quietly drops a word the speaker meant is worse
 * than one that reads a little roughly.
 */

/**
 * Fillers, Spanish and English.
 *
 * Only words that are pure hesitation. Notably absent: Spanish `o sea` and
 * English `so`, which look like filler and routinely carry the sentence — "o sea
 * que no lo hacemos" is a decision, not a stall.
 */
const FILLERS = [
  // Spanish
  'eh',
  'ehh',
  'em',
  'este',
  'pues',
  'bueno',
  'mmm',
  'ajá',
  // English
  'uh',
  'uhh',
  'um',
  'umm',
  'erm',
  'hmm',
  'like',
  'you know',
  'i mean',
] as const;

// Word-bounded so a filler never eats part of a real word: `este` must not
// match inside `esteban`, and `um` must not match inside `umbral`.
const FILLER_PATTERN = new RegExp(
  `(^|[\\s,])(?:${FILLERS.join('|')})(?=[\\s,.!?]|$)`,
  'gi',
);

/** `word word` → `word`, when someone stalls by repeating themselves. */
const IMMEDIATE_REPEAT_PATTERN = /\b(\p{L}+)(\s+\1\b)+/giu;

/** Space before punctuation, and missing space after it. */
const SPACE_BEFORE_PUNCTUATION = /\s+([,.;:!?])/g;
const MISSING_SPACE_AFTER_PUNCTUATION = /([,.;:!?])(?=[\p{L}])/gu;
const COLLAPSE_WHITESPACE = /\s{2,}/g;

/**
 * Strip filler and tidy the spacing of one block of speech.
 *
 * Idempotent: cleaning already-clean text returns it unchanged, which matters
 * because a note can be re-structured after more of its transcript arrives.
 */
export function cleanSpeech(text: string): string {
  let cleaned = text;

  // Fillers first: removing them creates the double spaces and stray commas the
  // later rules tidy up.
  let previous: string;
  do {
    previous = cleaned;
    // Repeated, because adjacent fillers overlap on the separator they share —
    // "eh, em, vale" needs a second pass to lose `em`.
    cleaned = cleaned.replace(FILLER_PATTERN, '$1');
  } while (cleaned !== previous);

  cleaned = cleaned.replace(IMMEDIATE_REPEAT_PATTERN, '$1');
  cleaned = cleaned.replace(SPACE_BEFORE_PUNCTUATION, '$1');
  cleaned = cleaned.replace(MISSING_SPACE_AFTER_PUNCTUATION, '$1 ');
  cleaned = cleaned.replace(COLLAPSE_WHITESPACE, ' ');
  // A block that began with filler is left starting with its separator.
  cleaned = cleaned.replace(/^[\s,]+/, '').trim();

  return capitaliseSentences(cleaned);
}

const SENTENCE_START = /(^|[.!?]\s+|¿|¡)(\p{Ll})/gu;

/**
 * Capitalise the first letter of each sentence.
 *
 * Recognisers are inconsistent about this, and a note whose sentences start
 * lowercase reads as broken even when every word is right. Only the first letter
 * is touched: anything else would corrupt names and acronyms the recogniser
 * capitalised correctly.
 */
function capitaliseSentences(text: string): string {
  return text.replace(SENTENCE_START, (_match, prefix: string, letter: string) => {
    return `${prefix}${letter.toUpperCase()}`;
  });
}
