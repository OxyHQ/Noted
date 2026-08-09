/**
 * Writing down what was actually said.
 *
 * The rest of `lib/structure` looks for the four things a meeting produces —
 * tasks, decisions, questions, figures. A lecture, a talk or a demo produces
 * none of them, and the note that came out was a bare list of the speaker's
 * rhetorical questions with the entire content missing. This module is the part
 * that takes notes: it picks the sentences a person would have written down.
 *
 * Extractive, not generative. Every line in the note is a sentence somebody
 * said, so nothing here can invent a claim — which is the whole reason it is
 * safe to run with no model, on every device, while the recording is still
 * going. A model rewrites this afterwards when the device has one; the point is
 * that the note is worth reading before it does.
 *
 * What makes a sentence worth keeping is how much of the talk's own vocabulary
 * it carries: terms that recur across a recording are what it is about, and the
 * sentences dense in them are the ones that carry it. That is a well-worn
 * measure, and it needs no understanding of the language — which is why it
 * works the same in Spanish and English without a rule written per language.
 */

import { splitSentences } from '@/lib/structure/extract';
import type { Block } from '@/lib/structure/segment';
import { dropNearDuplicates, normaliseForComparison } from '@/lib/structure/similar';

export interface KeyPoint {
  /** The sentence, as it was said. */
  text: string;
  /** Where it was said, for the reader to go back to the recording. */
  atMs: number;
}

/**
 * Words too common to say anything about what a recording is about.
 *
 * Both languages in one set on purpose: a bilingual meeting is normal, and
 * choosing a list per sentence would need language detection this module has no
 * business doing.
 */
const STOPWORDS = new Set([
  // Spanish
  'que', 'con', 'por', 'para', 'una', 'uno', 'los', 'las', 'del', 'como', 'más',
  'pero', 'sus', 'este', 'esta', 'esto', 'esos', 'esas', 'ese', 'esa', 'porque',
  'cuando', 'donde', 'muy', 'ser', 'está', 'están', 'hay', 'son', 'era', 'fue',
  'han', 'has', 'hemos', 'sido', 'todo', 'toda', 'todos', 'todas', 'ahora',
  'entonces', 'también', 'sobre', 'entre', 'desde', 'hasta', 'aquí', 'ahí',
  'algo', 'nada', 'cada', 'otro', 'otra', 'nos', 'les', 'sus', 'mismo',
  // English
  'the', 'and', 'that', 'this', 'these', 'those', 'with', 'for', 'from', 'have',
  'has', 'had', 'was', 'were', 'been', 'being', 'are', 'you', 'your', 'they',
  'them', 'their', 'there', 'here', 'what', 'when', 'where', 'which', 'who',
  'how', 'why', 'not', 'but', 'can', 'could', 'would', 'should', 'will', 'just',
  'about', 'into', 'than', 'then', 'some', 'any', 'all', 'one', 'two', 'its',
  'it\'s', 'i\'m', 'we\'re', 'don\'t', 'doesn\'t', 'get', 'got', 'going', 'like',
  'really', 'very', 'much', 'more', 'most', 'other', 'because', 'out', 'off',
]);

/** Shorter than this and a bullet carries nothing a reader could use. */
const MIN_POINT_CHARS = 25;

/** Fewer content words than this and a sentence is a reaction, not a point. */
const MIN_CONTENT_WORDS = 4;

/**
 * At most this many points per paragraph.
 *
 * Notes are not a transcript. A paragraph is a stretch of speech between pauses;
 * keeping a handful of its sentences is roughly what somebody writing by hand
 * gets down.
 */
const MAX_POINTS_PER_BLOCK = 4;

/** Roughly this share of a paragraph's sentences is kept. */
const KEEP_ONE_IN = 3;

/**
 * A ceiling for the whole note, so a two-hour recording stays a note.
 *
 * Past this the highest-scoring points are kept and the rest dropped, still in
 * the order they were said.
 */
const MAX_POINTS = 60;

/**
 * Openers that carry no meaning once the sentence is out of the conversation.
 *
 * Removed only from the START of a bullet: "so" in the middle of a sentence is
 * usually doing real work ("small enough so it fits"), and the same is true of
 * `entonces`.
 */
const LEADING_DISCOURSE =
  /^(?:so|and|but|then|now|okay|ok|right|well|anyway|y|pero|entonces|además|o sea|vale)\b[,\s]+/i;

function contentWords(text: string): string[] {
  return normaliseForComparison(text)
    .split(' ')
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

/**
 * How often each term is used across the whole recording.
 *
 * Counted once per sentence rather than per occurrence: a speaker who says a
 * word four times in one breath has not made it the subject of the talk, and
 * counting raw occurrences lets a single sentence promote itself.
 */
function termWeights(sentences: readonly string[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const sentence of sentences) {
    for (const word of new Set(contentWords(sentence))) {
      weights.set(word, (weights.get(word) ?? 0) + 1);
    }
  }
  return weights;
}

/**
 * How much a sentence answering a question the speaker just asked outranks one
 * that does not.
 *
 * A talk is built out of "so what is actually happening here?" followed by the
 * explanation, and the explanation is the whole reason the question was asked.
 * Salience alone ranked those answers below sentences that merely echoed the
 * talk's most repeated words, so the note kept the echo and dropped the point.
 */
const ANSWER_WEIGHT = 1.6;

function scoreSentence(
  sentence: string,
  weights: ReadonlyMap<string, number>,
  isOpening: boolean,
  answersQuestion: boolean,
): number {
  const unique = [...new Set(contentWords(sentence))];
  if (unique.length < MIN_CONTENT_WORDS) return 0;

  // Divided by the square root rather than the count: dividing by the count
  // makes a four-word sentence beat a twelve-word one that says three times as
  // much, and not dividing at all just picks the longest sentence every time.
  const salience =
    unique.reduce((total, word) => total + (weights.get(word) ?? 0), 0) / Math.sqrt(unique.length);

  // A figure is the thing people most regret not writing down.
  const carriesFigure = /\d/.test(sentence) ? 1.15 : 1;
  // The first sentence after a pause is usually someone saying what they are
  // about to talk about.
  const opens = isOpening ? 1.1 : 1;
  const answers = answersQuestion ? ANSWER_WEIGHT : 1;
  return salience * carriesFigure * opens * answers;
}

function tidy(sentence: string): string {
  const trimmed = sentence.replace(LEADING_DISCOURSE, '').trim();
  if (trimmed === '') return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function isQuestionSentence(sentence: string): boolean {
  // Questions have their own section; a bullet list that mixes the speaker's
  // rhetorical questions in with their claims reads as though nothing was
  // answered.
  return sentence.endsWith('?') || sentence.startsWith('¿');
}

/**
 * Pick the sentences worth writing down, in the order they were said.
 */
export function selectKeyPoints(blocks: readonly Block[]): KeyPoint[] {
  const sentencesByBlock = blocks.map((block) => splitSentences(block.text));
  const weights = termWeights(sentencesByBlock.flat());
  // Flattened, because the sentence that answers a question at the end of a
  // paragraph is the first sentence of the next one.
  const stream = sentencesByBlock.flat();
  let streamIndex = 0;

  const scored: { point: KeyPoint; score: number }[] = [];

  sentencesByBlock.forEach((sentences, blockIndex) => {
    const block = blocks[blockIndex];
    const blockStart = streamIndex;
    streamIndex += sentences.length;
    if (!block) return;

    const candidates = sentences
      .map((sentence, index) => {
        const answersQuestion = isQuestionSentence(stream[blockStart + index - 1] ?? '');
        return {
          text: tidy(sentence),
          score: scoreSentence(sentence, weights, index === 0, answersQuestion),
          index,
          answersQuestion,
        };
      })
      .filter(
        (candidate) =>
          candidate.score > 0 &&
          candidate.text.length >= MIN_POINT_CHARS &&
          !isQuestionSentence(candidate.text),
      );
    if (candidates.length === 0) return;

    // Every answer earns a slot. Ranking alone cannot express "this one is not
    // optional": with four answers and room for two, two explanations the
    // speaker gave go missing from the note whatever their score.
    const answers = candidates.filter((candidate) => candidate.answersQuestion).length;
    const keep = Math.min(
      MAX_POINTS_PER_BLOCK,
      Math.max(answers, 1, Math.ceil(candidates.length / KEEP_ONE_IN)),
    );
    const chosen = [...candidates]
      .sort((left, right) => right.score - left.score)
      .slice(0, keep)
      // Back into the order they were spoken: a note that reorders a paragraph
      // by importance stops following the talk.
      .sort((left, right) => left.index - right.index);

    for (const candidate of chosen) {
      scored.push({ point: { text: candidate.text, atMs: block.startMs }, score: candidate.score });
    }
  });

  const unique = dropNearDuplicates(scored, (entry) => entry.point.text);
  if (unique.length <= MAX_POINTS) return unique.map((entry) => entry.point);

  const strongest = new Set(
    [...unique].sort((left, right) => right.score - left.score).slice(0, MAX_POINTS),
  );
  return unique.filter((entry) => strongest.has(entry)).map((entry) => entry.point);
}
