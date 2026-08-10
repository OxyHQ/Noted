/**
 * Recordings to measure the note generator against.
 *
 * One fixture per shape the generator has to get right, each stating what a
 * reader would be annoyed to lose and what the recording genuinely contains —
 * so "the notes got better" stops being a claim and becomes a number that can
 * go down.
 *
 * ## What these are, and what they are not
 *
 * They are transcripts. Every one is written the way a recogniser emits speech —
 * run-on, unpunctuated in places, occasionally wrong — because a corpus of tidy
 * prose measures a recording nobody made. The recogniser errors in
 * `talk-transcript.ts` are real; the ones here are modelled on them.
 *
 * They are NOT a model benchmark. The model is 483 MB of weights and a GPU, and
 * a corpus scored against a mock of it would score the mock. What these measure
 * is the deterministic floor — the note produced when no model is installed, or
 * when one fails — which is the note a user is guaranteed and therefore the one
 * worth holding a line under.
 *
 * The lifecycle scenarios the epic also lists — capture interrupted, model
 * absent, load failure, finaliser failure and retry, a stale live pass trying to
 * commit after finalisation — are not here, because they are not about note
 * CONTENT and are already asserted where they happen: `lib/capture/__tests__/`
 * (coordinator, queue, lifecycle, status, model-failure-wiring) and
 * `lib/db/__tests__/artifact-schema.test.ts` for the commit guard itself.
 */

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import type { CaptureProfile } from '@noted/shared-types';

export interface EvalScenario {
  id: string;
  /** What this recording is, in one line — read out when a metric fails on it. */
  what: string;
  captureId: string;
  slices: readonly string[];
  /** The profile a user would pick, or `auto` to let the app decide. */
  profile: CaptureProfile;
  /** Facts a reader would be annoyed to lose. Substrings, matched loosely. */
  mustKeep: readonly string[];
  /** Every task the recording genuinely assigns. Empty is a real answer. */
  actions: readonly string[];
  /** Every question left genuinely unanswered when the recording ends. */
  openQuestions: readonly string[];
}

/** 58 seconds of speech per slice, which is roughly what a real one holds. */
const SLICE_MS = 58_000;

export function segmentsOf(scenario: EvalScenario): TranscriptSegment[] {
  return scenario.slices.map((text, index) => ({
    id: `${scenario.captureId}#${String(index)}.0`,
    captureId: scenario.captureId,
    sliceIndex: index,
    segmentIndex: 0,
    revision: index,
    startMs: index * 60_000,
    endMs: index * 60_000 + SLICE_MS,
    text,
    confidence: null,
    speakerHint: null,
    isFinal: true,
  }));
}

export const CORPUS: readonly EvalScenario[] = [
  {
    id: 'meeting-decisions-and-owners',
    what: 'A work meeting with decisions, tasks and the people who own them.',
    captureId: 'cap_meeting',
    profile: 'meeting',
    slices: [
      'Bueno empezamos la reunión son las diez y cuarto. El primer punto es el presupuesto del trimestre. ' +
        'Hemos decidido que congelamos las contrataciones hasta septiembre. Marta tiene que preparar el ' +
        'informe de costes para el viernes. Y hay que avisar al equipo de producto de esto.',
      'Segundo punto la migración. Javier va a hablar con el proveedor esta semana. Queda pendiente decidir ' +
        'si movemos también el almacenamiento, eso lo vemos la semana que viene porque falta el dato de coste. ' +
        'Nada más, gracias a todos.',
    ],
    mustKeep: ['congelamos las contrataciones', 'informe de costes', 'proveedor'],
    actions: [
      'Marta tiene que preparar el informe de costes para el viernes',
      'hay que avisar al equipo de producto',
      'Javier va a hablar con el proveedor esta semana',
      // "Queda pendiente decidir X" is a task with no owner rather than an open
      // question: somebody has to do the deciding, and a checklist is where a
      // reader looks for that. Stated here because a corpus that left it
      // ambiguous would be defining the answer by accident.
      'Queda pendiente decidir si movemos también el almacenamiento',
    ],
    openQuestions: [],
  },
  {
    id: 'question-answered-next-window',
    what: 'A question asked at the end of one window and answered in the next.',
    captureId: 'cap_answered',
    profile: 'meeting',
    slices: [
      'En esta reunión vemos el lanzamiento. La fecha sigue siendo el doce de marzo. ' +
        '¿Quién se encarga de la nota de prensa?',
      'Se encarga Lucía, ya lo habló con comunicación la semana pasada. Entonces la nota de prensa la ' +
        'lleva Lucía y salimos el doce de marzo.',
    ],
    mustKeep: ['doce de marzo', 'Lucía'],
    // "Se encarga Lucía" IS an assignment, even though it reports an
    // arrangement already made. The checklist is where the reader looks for who
    // is doing what.
    actions: ['Se encarga Lucía'],
    // Answered in the next breath. A note that still lists it as open is telling
    // the reader to go and find out something the recording already says.
    openQuestions: [],
  },
  {
    id: 'decision-reversed-later',
    what: 'A decision taken early and reversed before the recording ends.',
    captureId: 'cap_reversed',
    profile: 'meeting',
    slices: [
      'Orden del día. Hemos decidido que lanzamos en marzo, con el equipo actual, sin ampliar plantilla.',
      'Espera, con los números de ayer no llegamos. Cambiamos la decisión, no lanzamos en marzo, ' +
        'lo movemos a mayo. Queda así, mayo.',
    ],
    mustKeep: ['mayo'],
    actions: [],
    openQuestions: [],
  },
  {
    id: 'suggestion-is-not-a-task',
    what: 'Somebody floats an idea nobody agreed to. It is not a task.',
    captureId: 'cap_suggestion',
    profile: 'meeting',
    slices: [
      'En esta reunión hablamos del blog. Podríamos escribir un artículo sobre el lanzamiento, ' +
        'sería una idea. No sé, quizá estaría bien tener un vídeo también. Habría que verlo con calma. ' +
        'De momento lo dejamos ahí, no decidimos nada hoy.',
    ],
    mustKeep: ['artículo'],
    // Nothing here was assigned to anybody. "Podríamos" and "quizá estaría bien"
    // are the two constructions that most reliably become invented commitments.
    actions: [],
    openQuestions: [],
  },
  {
    id: 'talk-with-figures-no-actions',
    what: 'An event talk full of figures and examples that assigns nothing.',
    captureId: 'cap_event',
    profile: 'event',
    slices: [
      'Voy a hablar de una encuesta de dos mil diecisiete. Dos tercios de los trabajadores ya tenían ' +
        'entonces menos competencia lectora que los ordenadores de la época. ¿Y qué hacemos con eso? ' +
        'Pues lo que hicimos fue preguntar a quien sabía.',
      'La comparación que encontramos fue la imprenta. Cuando se inventó la imprenta la lectura dejó de ' +
        'ser cosa de unos pocos. ¿Deberíamos entonces dejar de aprender? No, al contrario, es exactamente ' +
        'cuando más falta hace.',
    ],
    mustKeep: ['dos mil diecisiete', 'imprenta'],
    actions: [],
    // Both questions are rhetorical and both are answered in the next sentence.
    openQuestions: [],
  },
  {
    id: 'recogniser-repeats-itself',
    what: 'Whisper repeating a phrase and re-emitting a corrected segment.',
    captureId: 'cap_repeats',
    profile: 'meeting',
    slices: [
      'En esta reunión vemos el informe. El informe el informe se entrega el jueves. Se entrega el jueves. ' +
        'Y hay que mandarlo a contabilidad.',
      'Perdón, no es el jueves, es el viernes. El informe se entrega el viernes y hay que mandarlo a ' +
        'contabilidad.',
    ],
    mustKeep: ['viernes'],
    actions: ['hay que mandarlo a contabilidad'],
    openQuestions: [],
  },
  {
    id: 'bilingual-discussion',
    what: 'Two languages in one recording, which is one recording and not two.',
    captureId: 'cap_bilingual',
    profile: 'meeting',
    slices: [
      'En esta reunión repasamos el roadmap. Hemos decidido que el beta sale en abril. ' +
        'So the beta ships in April and we freeze the scope now. Hay que avisar a los early adopters.',
    ],
    mustKeep: ['abril'],
    actions: ['Hay que avisar a los early adopters'],
    openQuestions: [],
  },
  {
    id: 'explicit-shopping-list',
    what: 'Somebody dictating a shopping list, item by item.',
    captureId: 'cap_shopping',
    profile: 'dictation',
    slices: [
      'Apunta la lista de la compra. Añade dos kilos de tomates. Añade una docena de huevos. ' +
        'Añade pan. Quita el pan, ya tengo. Añade leche.',
    ],
    mustKeep: ['tomates', 'huevos', 'leche'],
    actions: [],
    openQuestions: [],
  },
];
