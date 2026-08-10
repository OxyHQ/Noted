/**
 * Building the list somebody dictated.
 *
 * A spoken shopping list should become a checklist you can tick, not a paragraph
 * describing a person reading a list aloud. That much is presentation. What this
 * module actually has to get right is the corrections, because a list is dictated
 * the way people think — in passes:
 *
 * > Quiero una lista de la compra. Añade pollo, salchichas y pasta.
 * > Quita las salchichas.
 * > Ya tengo mozzarella, no la añadas.
 * > Pon dos kilos de pollo.
 *
 * Every one of those has to land on the item it means. Appending a contradictory
 * line instead — "salchichas" and then "quita las salchichas" as two entries — is
 * the failure mode, and it is what a naive transcript-to-bullets pass produces.
 *
 * Removals mark rather than delete, so the list keeps a record of a correction
 * the user watched happen, and an id they may have already touched.
 */

import type { ListCommand } from '@/lib/artifact/dictation/instructions';
import { itemId } from '@/lib/artifact/item-id';
import type {
  DocumentIntent,
  GeneratedChecklist,
  GeneratedChecklistItem,
  PendingExpansion,
  SourceRange,
} from '@/lib/artifact/types';
import { isNearDuplicate, normaliseForComparison } from '@/lib/structure/similar';

/** Which checklist a given intent produces. */
export function checklistKindFor(intent: DocumentIntent): GeneratedChecklist['kind'] {
  switch (intent) {
    case 'shopping-list':
      return 'shopping';
    case 'task-list':
      return 'actions';
    case 'packing-list':
      return 'packing';
    case 'steps':
      return 'steps';
    default:
      return 'custom';
  }
}

export interface DictatedList {
  intent: DocumentIntent;
  checklist: GeneratedChecklist | null;
  pendingExpansions: PendingExpansion[];
}

export interface BuildListInput {
  commands: readonly ListCommand[];
  captureId: string;
  /** Where a sentence said at `atMs` came from, for the item's evidence. */
  sourceAt: (atMs: number) => SourceRange[];
}

/**
 * Whether two list entries are the same thing.
 *
 * `isNearDuplicate` refuses to compare anything under three distinct words, and
 * it is right to — every word of "Yes" appears in "Yes, we can ship it". But a
 * shopping list is made almost entirely of one-word entries, so that rule would
 * make "pasta" and "pasta integral" two separate products.
 *
 * So short entries are compared by prefix on a word boundary, which is what "the
 * same thing, said more precisely" looks like when the thing is a noun. Longer
 * entries fall back to the general measure.
 */
export function sameListItem(left: string, right: string): boolean {
  const a = normaliseForComparison(left);
  const b = normaliseForComparison(right);
  if (a === '' || b === '') return false;
  if (a === b) return true;

  const shortest = Math.min(a.split(' ').length, b.split(' ').length);
  if (shortest < 3) return a.startsWith(`${b} `) || b.startsWith(`${a} `);
  return isNearDuplicate(left, right);
}

function findMatch(
  items: readonly GeneratedChecklistItem[],
  text: string,
): GeneratedChecklistItem | undefined {
  return items.find((item) => item.status !== 'removed' && sameListItem(item.text, text));
}

/**
 * "pasta para hacer una carbonara" is one item with a reason.
 *
 * Split apart so the reason can group the list — *separa lo de la carbonara de lo
 * de la pizza* — and so the same ingredient asked for twice, for two different
 * dishes, merges into one line instead of two nearly identical ones.
 */
const PURPOSE = /^(.+?)\s+para\s+(?:hacer\s+)?(.+)$/i;

function splitPurpose(text: string): { text: string; category?: string } {
  const found = PURPOSE.exec(text);
  if (!found) return { text };
  return { text: found[1].trim(), category: found[2].trim() };
}

export function buildDictatedList(input: BuildListInput): DictatedList {
  const items: GeneratedChecklistItem[] = [];
  const pendingExpansions: PendingExpansion[] = [];
  // The FIRST create decides what kind of list this is. A later one adds its
  // items to the same list rather than starting a second: one recording is one
  // note, and a person who says "y añade también" is still building one list.
  let intent: DocumentIntent | null = null;

  const add = (spoken: string, atMs: number): void => {
    const { text, category } = splitPurpose(spoken);
    const existing = findMatch(items, text);
    if (existing) {
      // Said twice. Keep the longer wording — "pasta" then "pasta integral" is a
      // person being more specific, not a second product — and keep whichever
      // reason was given, since one of the two mentions may not have had one.
      if (text.length > existing.text.length) existing.text = text;
      existing.category ??= category;
      return;
    }
    items.push({
      id: itemId('list', text),
      text,
      category,
      status: 'active',
      // Somebody said this out loud and asked for it to be written down. It is
      // grounded in the recording, and it is not something Noted supplied.
      origin: 'explicit-instruction',
      sources: input.sourceAt(atMs),
      checked: false,
    });
  };

  for (const command of input.commands) {
    switch (command.kind) {
      case 'create':
        intent ??= command.intent;
        for (const item of command.items) add(item, command.atMs);
        break;

      case 'add':
        for (const item of command.items) add(item, command.atMs);
        break;

      case 'remove': {
        const target = findMatch(items, command.item);
        // Marked, not deleted: the user watched the correction happen, and an id
        // they may already have touched has to keep pointing at something.
        if (target) target.status = 'removed';
        break;
      }

      case 'quantity': {
        const target = findMatch(items, command.item);
        // The quantity is a field rather than part of the text, so a later
        // correction replaces it instead of leaving "dos kilos de pollo" beside
        // "tres kilos de pollo".
        if (target) target.quantity = command.quantity;
        else {
          add(command.item, command.atMs);
          const added = findMatch(items, command.item);
          if (added) added.quantity = command.quantity;
        }
        break;
      }

      case 'expand': {
        const source = input.sourceAt(command.atMs)[0];
        if (source) pendingExpansions.push({ subject: command.subject, instructionSource: source });
        break;
      }
    }
  }

  if (items.length === 0) return { intent: intent ?? 'freeform', checklist: null, pendingExpansions };

  const resolved = intent ?? 'checklist';
  return {
    intent: resolved,
    checklist: {
      id: `checklist:${input.captureId}:dictated`,
      kind: checklistKindFor(resolved),
      items,
    },
    pendingExpansions,
  };
}
