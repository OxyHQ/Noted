/**
 * Reading the whole recording once, and settling it.
 *
 * The live pass is deliberately conservative: it sees the transcript so far and
 * has to answer in the seconds before the next slice. This runs once, when the
 * recording is over, and can do the things that need the whole thing at once —
 * merge a point somebody made twice in different words, close a question that was
 * answered two windows later, retire a decision that was overturned.
 *
 * ## What is honestly deterministic here, and what is not
 *
 * Two of those three are: merging semantic duplicates is a similarity
 * measurement, and closing an answered question falls out of asking the
 * whole-transcript pass which questions are STILL open — a question the talk
 * moved past is not one it reports.
 *
 * Detecting a contradiction is not. "Lanzamos el viernes" and "finalmente se
 * retrasa hasta el lunes" share no content words at all, so no overlap measure
 * relates them; understanding that they are the same subject is the model's job,
 * and the model path supplies statuses directly. What is deterministic is the
 * EXPLICIT correction: a decision that announces itself as a revision — "al
 * final", "finalmente", "en realidad", "actually", "instead" — supersedes the
 * decision before it. That rule is narrow on purpose, and it is documented as
 * narrow rather than dressed up as reconciliation.
 */

import type { GeneratedItem, GeneratedNoteArtifact, GeneratedSection } from '@noted/shared-types';
import { transitionItem, visibleItems } from '@/lib/artifact/artifact';
import { isProtected, type OverrideMap } from '@/lib/artifact/ownership';
import { mergeSources } from '@/lib/artifact/reduce';
import { isNearDuplicate } from '@/lib/structure/similar';

/**
 * A sentence announcing that it replaces what was said before.
 *
 * Explicit markers only. Tone is not evidence, and a rule that guessed would
 * quietly retire decisions nobody revoked — which is worse than leaving both in,
 * because the reader cannot tell it happened.
 */
const REVISION_MARKERS =
  /\b(?:al final|finalmente|en realidad|al fin y al cabo|cambio de plan|actually|in the end|instead|scratch that)\b/i;

/**
 * Merge items that say the same thing in different words.
 *
 * The FIRST wording keeps its id and its place — it is the one the reader has
 * already seen — while the fullest wording wins the text, because a sentence cut
 * short by a slice boundary and the complete version of it are the commonest pair
 * this meets. Both source ranges are kept: a point somebody made twice is
 * evidenced twice.
 */
export function mergeSemanticDuplicates<T extends GeneratedItem>(items: readonly T[]): T[] {
  const merged: T[] = [];
  for (const item of items) {
    const existing = merged.findIndex((kept) => isNearDuplicate(kept.text, item.text));
    if (existing === -1) {
      merged.push(item);
      continue;
    }
    const kept = merged[existing];
    merged[existing] = {
      ...kept,
      text: item.text.length > kept.text.length ? item.text : kept.text,
      sources: mergeSources(kept.sources, item.sources),
    };
  }
  return merged;
}

/**
 * Retire a decision that a later one explicitly revised.
 *
 * Only the most recent still-standing decision is retired, and only by a sentence
 * carrying a revision marker: "al final lo dejamos para el lunes" is somebody
 * correcting the last thing decided, which is what the marker means in practice.
 * Two unrelated decisions with a marker between them would be mis-paired, and
 * that is the cost of doing this without understanding the sentence — which is
 * why it takes an explicit marker and stops at one.
 */
export function supersedeRevisedDecisions<T extends GeneratedItem>(decisions: readonly T[]): T[] {
  const settled: T[] = [];
  for (const decision of decisions) {
    if (REVISION_MARKERS.test(decision.text)) {
      for (let index = settled.length - 1; index >= 0; index -= 1) {
        if (settled[index].status !== 'active') continue;
        // Not a near-duplicate: that pair is a restatement, and merging already
        // handled it. This is a different sentence replacing an earlier one.
        if (isNearDuplicate(settled[index].text, decision.text)) break;
        settled[index] = transitionItem(settled[index], 'superseded');
        break;
      }
    }
    settled.push(decision);
  }
  return settled;
}

/**
 * Close the questions the recording went on to answer.
 *
 * `stillOpen` is the whole-transcript pass's own verdict — a question the talk
 * moved past is not one it reports — so a question missing from it is a question
 * something was said after. It becomes `resolved` rather than being deleted, so
 * its id survives and the note can say the difference between "answered" and
 * "never mentioned again".
 */
export function closeAnsweredQuestions<T extends GeneratedItem>(
  questions: readonly T[],
  stillOpen: readonly GeneratedItem[],
  overrides: OverrideMap,
): T[] {
  return questions.map((question) => {
    if (isProtected(question.id, overrides)) return question;
    const open = stillOpen.some(
      (candidate) => candidate.id === question.id || isNearDuplicate(candidate.text, question.text),
    );
    return open ? question : transitionItem(question, 'resolved');
  });
}

/**
 * Settle an artifact.
 *
 * `previous` is what the live pass left on screen; `next` is the fresh reading of
 * the complete recording. The result carries the live pass's ids wherever the two
 * agree, so nothing the user touched loses its anchor when the note settles.
 */
export function finalizeArtifact(input: {
  previous: GeneratedNoteArtifact | null;
  next: GeneratedNoteArtifact;
  overrides: OverrideMap;
  now: string;
}): GeneratedNoteArtifact {
  const { next, overrides } = input;

  const sections: GeneratedSection[] = next.sections
    .map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => {
        if (block.kind === 'paragraph' || block.kind === 'quote') return block;
        const merged = mergeSemanticDuplicates(block.items);
        return {
          ...block,
          items: section.kind === 'decisions' ? supersedeRevisedDecisions(merged) : merged,
        };
      }),
    }))
    // A section survives when anything in it is still standing. Prose blocks are
    // retired individually; a list is retired when its every line is.
    .filter((section) =>
      section.blocks.some((block) =>
        block.kind === 'paragraph' || block.kind === 'quote'
          ? block.status === 'active'
          : visibleItems(block.items).length > 0,
      ),
    );

  const checklists = next.checklists
    .map((checklist) => ({ ...checklist, items: mergeSemanticDuplicates(checklist.items) }))
    .filter((checklist) => visibleItems(checklist.items).length > 0);

  // Every question the live pass ever raised, judged against the complete
  // recording — not only the ones the final pass happened to raise again.
  const raised = [...(input.previous?.openQuestions ?? []), ...next.openQuestions];
  const openQuestions = closeAnsweredQuestions(
    mergeSemanticDuplicates(raised),
    next.openQuestions,
    overrides,
  );

  return {
    ...next,
    stage: 'final',
    sections,
    checklists,
    openQuestions,
    createdAt: input.previous?.createdAt ?? next.createdAt,
    updatedAt: input.now,
  };
}
