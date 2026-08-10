/**
 * How good a note is, measured rather than judged.
 *
 * "The notes got better" is the kind of claim nobody can check, and every
 * rewrite of a generator makes it. These are the properties that can be computed
 * from a transcript and the artifact built from it, with no model and no opinion
 * involved — so a change that trades one of them away has to say so out loud.
 *
 * ## What is deliberately NOT here
 *
 * Timing and memory — time to first visible transcript, stop responsiveness,
 * finalisation duration, memory across a long recording — are properties of a
 * device under load, and a number produced for them in a node process measures
 * the node process. They belong to the device matrix, and inventing an in-suite
 * proxy for them would be worse than leaving them out, because a green number
 * reads as a measurement.
 *
 * An LLM judge is not here either, and that is the epic's own rule: important
 * behaviour needs explicit fixture assertions. A judge may compare two notes
 * qualitatively; it may not be the only thing that says a note is correct.
 */

import { allItems, visibleItems } from '@/lib/artifact/artifact';
import { renderArtifact } from '@/lib/artifact/render';
import type { GeneratedNoteArtifact } from '@noted/shared-types';

/** Case- and accent-insensitive, punctuation-free. Two lines that differ only there are one line. */
export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How much of what mattered survived.
 *
 * The fixture names the facts a reader would be annoyed to lose — a date, a
 * figure, a decision — and this counts how many of them the note still contains.
 * Not "did it keep every word": a summary that kept every word would score
 * perfectly and be useless.
 */
export function retention(artifact: GeneratedNoteArtifact, mustKeep: readonly string[]): {
  kept: string[];
  lost: string[];
  ratio: number;
} {
  // The body AND the checklist. `renderArtifact` deliberately keeps the
  // checklist out of the prose — two copies of a task disagree the moment one is
  // ticked — so a shopping list scores zero on the body alone, which measures
  // this function rather than the note.
  // The title, the body AND the checklist — everything the reader sees.
  // `renderArtifact` carries neither the title nor the checklist: the title is
  // its own field the composer places above the note, and two copies of a task
  // disagree the moment one is ticked. A metric reading only the body scores a
  // shopping list at zero, which measures this function rather than the note.
  const note = normalizeForComparison(
    [artifact.title?.text ?? '', renderArtifact(artifact), ...actionsAndListItems(artifact)].join(
      '\n',
    ),
  );
  const kept = mustKeep.filter((fact) => note.includes(normalizeForComparison(fact)));
  const lost = mustKeep.filter((fact) => !note.includes(normalizeForComparison(fact)));
  return { kept, lost, ratio: mustKeep.length === 0 ? 1 : kept.length / mustKeep.length };
}

/** Every checklist line, of every kind — the half of the note prose does not carry. */
function actionsAndListItems(artifact: GeneratedNoteArtifact): string[] {
  return artifact.checklists.flatMap((checklist) =>
    visibleItems(checklist.items).map((item) => item.text),
  );
}

/**
 * Lines the note asserts that nothing in the recording supports.
 *
 * An item claiming to come from the transcript with no source range is
 * unfalsifiable: the reader cannot check it and neither can anything else. A
 * `derived-from-instruction` item is a different thing — it is knowledge the
 * user explicitly authorised, and it carries its receipt in `instructionSource`.
 */
export function unsupportedClaims(artifact: GeneratedNoteArtifact): string[] {
  return allItems(artifact)
    .filter((unit) => unit.origin === 'transcript' && unit.sources.length === 0)
    .map((unit) => unit.text);
}

/** A derived item with no receipt — knowledge that entered the note unauthorised. */
export function unauthorisedDerivations(artifact: GeneratedNoteArtifact): string[] {
  return allItems(artifact)
    .filter((unit) => unit.origin === 'derived-from-instruction' && !unit.instructionSource)
    .map((unit) => unit.text);
}

/** Every task the note is currently showing. */
export function actionTexts(artifact: GeneratedNoteArtifact): string[] {
  return artifact.checklists
    .filter((checklist) => checklist.kind === 'actions')
    .flatMap((checklist) => visibleItems(checklist.items))
    .map((item) => item.text);
}

/**
 * Precision, in the sense that matters here: what fraction of what it produced
 * belongs.
 *
 * Recall is deliberately not the headline. A missed task is a line still
 * readable in the transcript; an invented one is a commitment nobody made, in a
 * note the user trusts. The fixtures state the tasks a recording really contains
 * so recall is still visible as `missed`.
 */
export function precision(
  produced: readonly string[],
  expected: readonly string[],
): { correct: string[]; spurious: string[]; missed: string[]; ratio: number } {
  const wanted = expected.map(normalizeForComparison);
  const matches = (text: string): boolean => {
    const normalized = normalizeForComparison(text);
    return wanted.some((want) => normalized.includes(want) || want.includes(normalized));
  };

  const correct = produced.filter(matches);
  const spurious = produced.filter((text) => !matches(text));
  const missed = expected.filter(
    (want) => !produced.some((text) => normalizeForComparison(text).includes(normalizeForComparison(want))),
  );
  return {
    correct,
    spurious,
    missed,
    ratio: produced.length === 0 ? 1 : correct.length / produced.length,
  };
}

/**
 * Lines that say the same thing twice.
 *
 * Two windows both covering the moment somebody stated a decision is the ordinary
 * way this happens, and a reader reads it as the decision having been made twice.
 */
export function duplicates(artifact: GeneratedNoteArtifact): string[] {
  // Per surface, not across all of them. A sentence that is both a highlight and
  // a task appears once in the body and once in the checklist, and the reader
  // sees each in its own place — counting that as a repetition would measure the
  // renderer's deliberate separation as a defect.
  const surfaces: string[][] = [
    artifact.sections.flatMap((section) =>
      section.blocks.flatMap((block) =>
        block.kind === 'paragraph' || block.kind === 'quote'
          ? [block.text]
          : visibleItems(block.items).map((item) => item.text),
      ),
    ),
    ...artifact.checklists.map((checklist) =>
      visibleItems(checklist.items).map((item) => item.text),
    ),
    visibleItems(artifact.openQuestions).map((item) => item.text),
  ];

  const repeated: string[] = [];
  for (const surface of surfaces) {
    const seen = new Set<string>();
    for (const text of surface) {
      const key = normalizeForComparison(text);
      if (key.length === 0) continue;
      if (seen.has(key)) repeated.push(text);
      seen.add(key);
    }
  }
  return repeated;
}

/**
 * How much of a note survived the next pass, by identity rather than by text.
 *
 * The whole reason items have stable ids: a live pass runs every few seconds, and
 * one that re-mints every id can only make the note flicker. `churn` is the
 * fraction of the earlier note's items that the later one no longer has, and it
 * is the number that goes wrong when identity breaks.
 *
 * **Both arguments must come from the real path** — `reduceLiveArtifact` and
 * `finalizeArtifact` — and not from two independent builds of the same
 * transcript. Two independent builds share no history by construction, so this
 * would report churn the app never produces and read as a defect in it. That
 * mistake was made once here already, which is why it is written down.
 */
export function stability(
  before: GeneratedNoteArtifact,
  after: GeneratedNoteArtifact,
): { survived: number; churn: number } {
  const earlier = allItems(before).map((unit) => unit.id);
  if (earlier.length === 0) return { survived: 0, churn: 0 };
  const later = new Set(allItems(after).map((unit) => unit.id));
  const survived = earlier.filter((id) => later.has(id)).length;
  return { survived, churn: 1 - survived / earlier.length };
}
