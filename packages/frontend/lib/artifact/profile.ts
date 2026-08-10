/**
 * What kind of recording this is — and who gets to say so.
 *
 * Classification is an aid, never a source of truth. A user who picked "Class"
 * before pressing record has told Noted something it cannot work out for itself,
 * and quietly overruling them because the first minute sounded like a meeting is
 * the kind of cleverness that makes an app feel untrustworthy.
 *
 * So the order is fixed and the code is the whole rule:
 *
 * 1. what the user chose in the UI
 * 2. what they said out loud ("esto es una clase")
 * 3. what the recording looks like
 * 4. nothing — general notes, which is a fine answer
 */

import type { ListCommand } from '@/lib/artifact/dictation/instructions';
import type { CaptureProfile } from '@/lib/artifact/types';
import { splitSentences } from '@/lib/structure/extract';

export interface ProfileSources {
  /** What the user picked. `auto` means they did not pick. */
  selected?: CaptureProfile;
  /** What they said out loud, if anything. */
  spoken?: CaptureProfile | null;
  /** What the recording looks like. */
  classified?: CaptureProfile | null;
}

export function resolveProfile(sources: ProfileSources): CaptureProfile {
  if (sources.selected && sources.selected !== 'auto') return sources.selected;
  if (sources.spoken && sources.spoken !== 'auto') return sources.spoken;
  if (sources.classified && sources.classified !== 'auto') return sources.classified;
  return 'auto';
}

/**
 * Somebody saying what this recording is.
 *
 * Requires a naming construction — "esto es una clase", "grábalo como entrevista"
 * — so that a lecture ABOUT meetings does not classify itself as a meeting. The
 * subject of a sentence and the nature of the recording are different things, and
 * a keyword search cannot tell them apart.
 */
const SPOKEN_PROFILES: readonly { pattern: RegExp; profile: CaptureProfile }[] = [
  { pattern: /\b(?:esto es|es)\s+(?:una?\s+)?(?:clase|lección|charla magistral)\b|\bthis is a (?:class|lecture)\b/i, profile: 'lecture' },
  { pattern: /\b(?:esto es|es)\s+(?:una?\s+)?(?:reunión|junta|daily|one[- ]on[- ]one|1:1)\b|\bthis is a meeting\b/i, profile: 'meeting' },
  { pattern: /\b(?:esto es|es)\s+(?:una?\s+)?entrevista\b|\bthis is an interview\b/i, profile: 'interview' },
  { pattern: /\b(?:esto es|es)\s+(?:una?\s+)?(?:conferencia|ponencia|charla|keynote)\b|\bthis is a (?:talk|conference|keynote)\b/i, profile: 'event' },
  { pattern: /\b(?:esto es|es)\s+(?:una?\s+)?(?:lluvia de ideas|brainstorm(?:ing)?)\b|\bthis is a brainstorm\b/i, profile: 'brainstorm' },
  {
    pattern: /\b(?:gráb(?:a|alo|ame)|anota|apunta)\w*\s+(?:esto\s+)?como\s+(?:una?\s+)?(clase|reunión|entrevista|conferencia|charla|lluvia de ideas|dictado)\b/i,
    profile: 'auto',
  },
];

/** The profile named in a "record this as a …" instruction. */
const NAMED_AS: Readonly<Record<string, CaptureProfile>> = {
  clase: 'lecture',
  reunión: 'meeting',
  entrevista: 'interview',
  conferencia: 'event',
  charla: 'event',
  'lluvia de ideas': 'brainstorm',
  dictado: 'dictation',
};

export function spokenProfile(
  blocks: readonly { text: string; startMs: number }[],
): CaptureProfile | null {
  for (const block of blocks) {
    for (const sentence of splitSentences(block.text)) {
      for (const entry of SPOKEN_PROFILES) {
        const found = entry.pattern.exec(sentence);
        if (!found) continue;
        if (entry.profile !== 'auto') return entry.profile;
        const named = found[1]?.toLowerCase();
        if (named && named in NAMED_AS) return NAMED_AS[named];
      }
    }
  }
  return null;
}

/**
 * How many sentences in a row have to be questions before this reads as an
 * interview rather than as somebody thinking aloud.
 */
const INTERVIEW_QUESTION_RATIO = 0.25;

/** Below this many sentences, a ratio says nothing at all. */
const MIN_SENTENCES_TO_CLASSIFY = 8;

const EVENT_MARKERS = /\b(?:el ponente|la ponente|esta charla|esta sesión|el keynote|the speaker|this talk|this session)\b/i;
const LECTURE_MARKERS = /\b(?:hoy vamos a ver|en la clase de hoy|el tema de hoy|para el examen|apuntad|today we(?:'| a)re going to (?:look at|cover))\b/i;
const BRAINSTORM_MARKERS = /\b(?:lluvia de ideas|se me ocurre|y si probamos|podríamos probar|what if we|brainstorm)\b/i;
/**
 * A meeting names itself.
 *
 * `agenda` used to be in here on its own, and it misclassified the talk in #59 as
 * a meeting — the speaker says "AI was not on the agenda", which is a topic, not
 * a description of the recording. A bare noun anyone might discuss is not
 * evidence about what a recording IS; only a construction that names it is.
 */
const MEETING_MARKERS =
  /\b(?:empezamos la reunión|en esta reunión|orden del día|puntos? del día|el acta|action items?|this meeting|the agenda for)\b/i;

/**
 * What the recording looks like.
 *
 * Deliberately weak, and it is meant to be: this is the third opinion, consulted
 * only when nobody said. Anything it cannot recognise stays `auto`, which is a
 * complete answer — general notes are what most recordings want.
 */
/**
 * How long a stretch of speech has to run before it stops sounding like a turn.
 *
 * A conversation is made of turns; a talk is made of paragraphs. Nobody holds the
 * floor for six hundred characters in a stand-up, and everybody does in a lecture.
 */
const MONOLOGUE_BLOCK_CHARS = 400;

/** Below this, there is not enough recording to say anything about its shape. */
const MIN_BLOCKS_TO_READ_SHAPE = 3;

/**
 * How many question-then-answer pairs mark somebody thinking aloud at an
 * audience.
 *
 * A rhetorical question is the defining move of a talk: "So what about the
 * humans? Should we give up learning altogether?" — asked and answered by the
 * same voice, seconds apart. Two is enough to be a habit rather than an accident.
 */
const RHETORICAL_PAIRS = 2;

/**
 * Whether one person is talking at an audience.
 *
 * Structure rather than vocabulary, which is the point: the recording in #59
 * opens "I'm going to talk about humans", and no list of marker phrases was ever
 * going to catch that. What DOES catch it is that one voice holds the floor for
 * minutes at a time and answers its own questions.
 *
 * Deliberately conservative. Getting this wrong costs a note organised as the
 * wrong kind of document, so it takes three signals agreeing, and anything it
 * cannot read stays `auto` — a general document, which is a fine answer.
 */
function isMonologue(
  blocks: readonly { text: string; startMs: number; speaker?: string | null }[],
  sentences: readonly string[],
): boolean {
  if (blocks.length < MIN_BLOCKS_TO_READ_SHAPE) return false;

  // More than one attributed voice is a conversation, whatever else it looks
  // like. An unattributed transcript says nothing either way.
  const speakers = new Set(
    blocks.map((block) => block.speaker).filter((speaker): speaker is string => Boolean(speaker)),
  );
  if (speakers.size > 1) return false;

  const meanChars =
    blocks.reduce((total, block) => total + block.text.length, 0) / blocks.length;
  if (meanChars < MONOLOGUE_BLOCK_CHARS) return false;

  let rhetorical = 0;
  for (const [index, sentence] of sentences.entries()) {
    const asked = sentence.endsWith('?') || sentence.startsWith('¿');
    const next = sentences[index + 1];
    if (asked && next && !next.endsWith('?') && !next.startsWith('¿')) rhetorical += 1;
  }
  return rhetorical >= RHETORICAL_PAIRS;
}

export function classifyProfile(
  blocks: readonly { text: string; startMs: number; speaker?: string | null }[],
  commands: readonly ListCommand[],
): CaptureProfile {
  const sentences = blocks.flatMap((block) => splitSentences(block.text));
  const joined = sentences.join(' ');

  // The markers come first, and this order is the interesting part: somebody
  // dictating a shopping list mid-meeting is still in a meeting. Reading the
  // commands first would turn the whole recording into a list and throw away
  // everything else that was said.
  if (LECTURE_MARKERS.test(joined)) return 'lecture';
  if (MEETING_MARKERS.test(joined)) return 'meeting';
  if (BRAINSTORM_MARKERS.test(joined)) return 'brainstorm';
  if (EVENT_MARKERS.test(joined)) return 'event';

  // With nothing else to go on, somebody saying "write this down" out loud is
  // the one signal with no ambiguity in it.
  if (commands.length > 0) return 'dictation';

  if (isMonologue(blocks, sentences)) return 'event';

  if (sentences.length >= MIN_SENTENCES_TO_CLASSIFY) {
    const questions = sentences.filter(
      (sentence) => sentence.endsWith('?') || sentence.startsWith('¿'),
    ).length;
    if (questions / sentences.length >= INTERVIEW_QUESTION_RATIO) return 'interview';
  }

  return 'auto';
}
