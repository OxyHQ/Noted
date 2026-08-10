/**
 * Section and checklist headings, in the language the reader chose.
 *
 * These stay in the app while the artifact itself does not: they are UI copy,
 * translated per session, and the server has no business holding a default
 * English heading for a note it only stores.
 */
export interface ArtifactLabels {
  decisions: string;
  questions: string;
  actions: string;
  concepts: string;
  examples: string;
  ideas: string;
  takeaways: string;
  shopping: string;
  packing: string;
  steps: string;
  /** Label for the person a recording is about. */
  speaker: string;
  /**
   * What the rule-based pass produces.
   *
   * Named for what it is. It selects sentences somebody said; calling that a
   * finished note is how a talk ended up reading as though the speaker had
   * written it.
   */
  highlights: string;
}

export const DEFAULT_ARTIFACT_LABELS: ArtifactLabels = {
  decisions: 'Decisions',
  questions: 'Open questions',
  actions: 'Actions',
  concepts: 'Concepts',
  examples: 'Examples',
  ideas: 'Ideas',
  takeaways: 'Takeaways',
  shopping: 'Shopping list',
  packing: 'Packing list',
  steps: 'Steps',
  speaker: 'Speaker',
  highlights: 'Transcript highlights',
};
