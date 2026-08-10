/**
 * Which step of writing a note failed.
 *
 * `errorCode: 'finalize'` was one word for eight different failures, and the
 * difference is exactly what a person needs to know: a model that could not
 * download is a retry worth offering, a SQLite write that failed is not the same
 * problem, and a transcript that never arrived is a third. The generic code left
 * the real cause in a development log, where the user cannot reach it and a retry
 * cannot act on it.
 *
 * Privacy-safe by construction: a code, never a message. The underlying exception
 * is logged locally with its stack and never carries transcript text or model
 * output — a note is about as private as a document gets, and an error string is
 * the easiest place for it to leak.
 */

export type NoteProcessingErrorCode =
  /** The rule-based pass — the one that must always work — did not. */
  | 'deterministic_generate'
  /** The artifact could not be written to the local store. */
  | 'artifact_persist'
  /** The note could not be composed or saved. */
  | 'note_compose'
  /** The model's weights could not be fetched. */
  | 'model_download'
  /** The weights arrived and the runtime refused them. */
  | 'model_load'
  /** Generation started and failed part-way. */
  | 'model_inference'
  /** The reply came back and was not the shape it was asked for. */
  | 'model_output_invalid'
  /** The reply stopped mid-answer. */
  | 'model_output_truncated';

/** Codes that describe the optional improvement rather than the note itself. */
export const ENHANCEMENT_ERROR_CODES: readonly NoteProcessingErrorCode[] = [
  'model_download',
  'model_load',
  'model_inference',
  'model_output_invalid',
  'model_output_truncated',
];

export function isEnhancementError(code: string | null): boolean {
  return code !== null && (ENHANCEMENT_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Read a thrown value as a stage.
 *
 * Deliberately narrow: only an error this app threw on purpose, carrying its own
 * code, is trusted. Anything else is inference failure — the commonest cause and
 * the least misleading guess — rather than a string match against a runtime's
 * wording, which changes between versions and languages.
 */
export class NoteProcessingError extends Error {
  constructor(
    readonly code: NoteProcessingErrorCode,
    readonly cause?: unknown,
  ) {
    super(code);
    this.name = 'NoteProcessingError';
  }
}

export function errorCodeOf(error: unknown, fallback: NoteProcessingErrorCode): NoteProcessingErrorCode {
  return error instanceof NoteProcessingError ? error.code : fallback;
}
