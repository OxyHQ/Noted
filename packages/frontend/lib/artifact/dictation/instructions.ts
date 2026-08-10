/**
 * Telling "write this down" apart from "we talked about it".
 *
 * Most of a recording is discussion, and discussion may only ever be REPORTED.
 * Sometimes a person is not discussing at all — they are dictating: *haz una
 * lista de la compra, pollo, salchichas y pasta*. That is an instruction to build
 * something, and the note should be a checklist rather than a prose summary of
 * somebody reading a list aloud.
 *
 * The distinction has real teeth, because it is also what decides when Noted may
 * contribute knowledge of its own:
 *
 * > *Hablamos de hacer una pizza* does not authorise adding flour.
 * > *Añade todos los ingredientes para una pizza* does.
 *
 * So this module only ever recognises EXPLICIT instructions. Every pattern below
 * needs an imperative aimed at the note — never a topic, never a tone. A missed
 * instruction costs the user retyping a line; an invented one puts words in a
 * note they will trust.
 */

import type { DocumentIntent } from '@/lib/artifact/types';
import { splitSentences } from '@/lib/structure/extract';

export interface Located {
  /** Where in the recording it was said. */
  atMs: number;
  /** The sentence itself, kept so a derived item can cite its authorisation. */
  sentence: string;
}

export type ListCommand = Located &
  (
    | { kind: 'create'; intent: DocumentIntent; items: string[] }
    | { kind: 'add'; items: string[] }
    /** "quita las salchichas", "ya tengo mozzarella" — both mean: not on the list. */
    | { kind: 'remove'; item: string }
    | { kind: 'quantity'; item: string; quantity: string }
    /**
     * "añade todos los ingredientes para una pizza de pollo".
     *
     * The one command that authorises Noted to supply something nobody said. It
     * carries the subject so a generator can act on it and the sentence so every
     * item it produces can point back at the permission.
     */
    | { kind: 'expand'; subject: string }
  );

/**
 * Which kind of list an instruction asks for.
 *
 * Ordered from most specific to least: "lista de la compra" is a shopping list
 * before it is a list, and a rule that checked the generic pattern first would
 * never see the specific one.
 */
const LIST_KINDS: readonly { pattern: RegExp; intent: DocumentIntent }[] = [
  { pattern: /\blista (?:de (?:la )?)?compra\b|\bshopping list\b/i, intent: 'shopping-list' },
  { pattern: /\blista de (?:tareas|pendientes)\b|\b(?:to-?do|task) list\b/i, intent: 'task-list' },
  {
    pattern: /\blista (?:de|del) (?:equipaje|maleta)\b|\bqué (?:me )?llevo\b|\bpacking list\b/i,
    intent: 'packing-list',
  },
  { pattern: /\besquema de estudio\b|\bstudy outline\b/i, intent: 'study-outline' },
  { pattern: /\b(?:los )?pasos para\b|\bstep[- ]by[- ]step\b|\bsteps to\b/i, intent: 'steps' },
  { pattern: /\blista\b|\bchecklist\b|\blist\b/i, intent: 'checklist' },
];

/**
 * An imperative aimed at the note.
 *
 * `quiero` and `necesito` are in because "quiero una lista de la compra" is how
 * people actually dictate — it is a request, not a description of a want.
 */
const CREATE_PATTERNS: readonly RegExp[] = [
  /\b(?:haz|hazme|crea|créame|prepara|prepárame|arma)\s+(?:una?\s+)?(?:nueva\s+)?lista\b/i,
  /\b(?:quiero|necesito)\s+(?:una?\s+)?lista\b/i,
  /\b(?:make|create|start)\s+(?:me\s+)?an?\s+(?:new\s+)?(?:shopping\s+|packing\s+|task\s+|to-?do\s+)?list\b/i,
  /\bi\s+(?:want|need)\s+an?\s+(?:shopping\s+|packing\s+|task\s+|to-?do\s+)?list\b/i,
];

const ADD_PATTERNS: readonly RegExp[] = [
  /\b(?:añade|añádele|agrega|agrégale|pon|ponme|apunta|apúntame|anota|incluye)\b/i,
  /\b(?:add|put|note down|include)\b/i,
];

/**
 * Removals, each capturing the thing being removed.
 *
 * They all carry their item, and that is deliberate. "No la añadas" on its own is
 * a pronoun, and resolving it would mean guessing which item was meant — a guess
 * that deletes the wrong line off somebody's shopping list. So a bare pronoun is
 * not a removal here; "ya tengo mozzarella, no la añadas" is, because the other
 * clause says what it is.
 *
 * "I already have it" sits with them for the same reason it reads nothing like a
 * removal: it is the phrasing people actually use while shopping. The item is not
 * wrong, it is simply not needed.
 */
const REMOVE_PATTERNS: readonly RegExp[] = [
  /\b(?:quita|quítame|quítalo|elimina|borra|saca)\s+(?:de la lista\s+)?(.+)/i,
  /\b(?:ya tengo|ya tenemos|no hace falta|no necesito|no necesitamos)\s+(.+)/i,
  /\b(?:remove|delete|drop|take off)\s+(.+)/i,
  /\b(?:i(?:'ve| have)? already (?:have|got)|we already have|don'?t need)\s+(.+)/i,
];

/** "añade todos los ingredientes necesarios para una pizza de pollo". */
const EXPAND_PATTERNS: readonly RegExp[] = [
  /\b(?:todos\s+los\s+ingredientes|todo\s+lo\s+necesario|lo\s+que\s+(?:haga|hace)\s+falta)\b[^.]*?\bpara\s+(?:hacer\s+)?(.+)/i,
  /\ball (?:of )?the ingredients\b[^.]*?\bfor\s+(?:making\s+)?(.+)/i,
];

/** "dos kilos de pollo", "2 kg de pollo", "a dozen eggs". */
const QUANTITY_PATTERN =
  /\b((?:\d+(?:[.,]\d+)?|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media|medio|a|an|two|three|four|five|six|seven|eight|nine|ten|half|a dozen|una docena)\s*(?:kilos?|kg|gramos?|gr?|litros?|l|mililitros?|ml|paquetes?|botellas?|latas?|docenas?|unidades?|piezas?|barras?|bolsas?|packs?|bottles?|cans?|dozen|units?)?)\s+de\s+(.+)/i;

/** Everything after the instruction verb or the colon that introduces the items. */
function itemsPart(sentence: string): string {
  const afterColon = sentence.split(':').slice(1).join(':');
  if (afterColon.trim() !== '') return afterColon;
  const afterVerb = /\b(?:añade|añádele|agrega|agrégale|pon|ponme|apunta|apúntame|anota|incluye|add|put|include)\b(.*)/i.exec(
    sentence,
  );
  return afterVerb?.[1] ?? '';
}

/**
 * Split "pollo, salchichas y pasta" into three items.
 *
 * Nothing clever: commas and the word for "and". A grammar would be wrong more
 * interestingly than this is wrong.
 */
export function splitItems(text: string): string[] {
  return text
    .split(/,| y | e | and |&/i)
    .map((item) =>
      item
        .replace(/^\s*(?:de |del |la |el |las |los |un |una |unos |unas |the |some )/i, '')
        // "…y pasta A LA LISTA DE LA COMPRA" — where to put it, not another
        // thing to buy. Without this the last item of every such sentence is the
        // item plus the name of the list it belongs to.
        .replace(/\s+(?:a|en|para)\s+(?:la|mi|el|los|las)\s+lista\b.*$/i, '')
        .replace(/\s+to\s+(?:the|my)\s+\w*\s*list\b.*$/i, '')
        .replace(/[.!?¡¿]+$/, '')
        .trim(),
    )
    .filter((item) => item.length > 1);
}

function matches(sentence: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(sentence));
}

function intentOf(sentence: string): DocumentIntent {
  return LIST_KINDS.find((kind) => kind.pattern.test(sentence))?.intent ?? 'checklist';
}

/**
 * Read one sentence as a command, or decide it is ordinary speech.
 *
 * Order matters, and each step is a real precedence rather than an accident:
 *
 * 1. **Expansion first.** "Añade todos los ingredientes para una pizza" also
 *    matches the ordinary add pattern, and reading it as one would file "todos
 *    los ingredientes para una pizza" as a shopping item.
 * 2. **Removals before additions**, because "no la añadas" contains "añad".
 * 3. **Quantity before a plain add**, so "pon dos kilos de pollo" updates the
 *    chicken rather than adding a second, differently-worded chicken.
 */
export function parseCommand(sentence: string, atMs: number): ListCommand | null {
  const located = { atMs, sentence };

  for (const pattern of EXPAND_PATTERNS) {
    const found = pattern.exec(sentence);
    if (found) {
      const subject = found[1].replace(/[.!?]+$/, '').trim();
      if (subject !== '') return { ...located, kind: 'expand', subject };
    }
  }

  for (const pattern of REMOVE_PATTERNS) {
    const found = pattern.exec(sentence);
    if (!found) continue;
    const item = splitItems(found[1])[0];
    if (item) return { ...located, kind: 'remove', item };
  }

  const isCreate = matches(sentence, CREATE_PATTERNS);
  const isAdd = matches(sentence, ADD_PATTERNS);
  if (!isCreate && !isAdd) return null;

  const tail = isCreate && itemsPart(sentence).trim() === '' ? '' : itemsPart(sentence);

  const quantity = QUANTITY_PATTERN.exec(tail);
  if (quantity && !isCreate) {
    const item = splitItems(quantity[2])[0];
    if (item) {
      return { ...located, kind: 'quantity', item, quantity: quantity[1].trim() };
    }
  }

  const items = splitItems(tail);
  if (isCreate) return { ...located, kind: 'create', intent: intentOf(sentence), items };
  return items.length > 0 ? { ...located, kind: 'add', items } : null;
}

/** Every command in a recording, oldest first. */
export function parseListCommands(
  blocks: readonly { text: string; startMs: number }[],
): ListCommand[] {
  return blocks.flatMap((block) =>
    splitSentences(block.text)
      .map((sentence) => parseCommand(sentence, block.startMs))
      .filter((command): command is ListCommand => command !== null),
  );
}
