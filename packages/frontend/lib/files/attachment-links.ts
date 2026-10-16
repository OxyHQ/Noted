/**
 * A note's attachments, registered as uses of the owner's files (Oxy ADR 0043).
 *
 * A note is a page of the owner's notes database in Nilo, and its attachments
 * are Oxy files on that page (`@oxy.so/nilo-contracts` `notes.ts`). Nilo is the
 * application that uses them: it stores the page, serves its files and is the
 * only server that sees a file leave the page or the page go, so the usage
 * Oxy records — the file reference — is Nilo's, under the same target Nilo's
 * own uploads use (`NILO_OXY_APPLICATION_ID`, `NILO_FILE_ENTITY_TYPE`, the
 * page id, which is the note id).
 *
 * What only Noted can do is the OWNER's half. An attachment is usually a
 * private file, and Oxy lets an application reference (and serve) a person's
 * private file only after that person attached it to the application with
 * their own session (ADR 0043 D4, ADR 0021); Nilo's service token cannot do it
 * for them. So this device links every attachment of its notes to Nilo with
 * the signed-in owner's session, and records that it did in
 * `attachment_links`:
 *
 * - The table is DERIVED from `notes.attachments_json` on every sync
 *   ({@link deriveAttachmentLinkStatements}): a new attachment becomes
 *   `pending`, one that left its note (or whose note was deleted) is forgotten.
 *   An install that already had attachments back-fills on its first sync.
 * - A pending row is linked BEFORE the note that names it is sent to Nilo
 *   ({@link linkNoteAttachments}, called by the outbox). The order matters: a
 *   public file already on the page can be referenced by Nilo's reconciliation
 *   with its service token, and Oxy then answers the owner's later link
 *   `exists` without recording the owner, so the ADR 0021 grant never lands.
 *   A link for a page that is never saved is harmless: Nilo's reconciliation
 *   removes it. The end of every sync works through whatever is still due
 *   ({@link syncAttachmentLinks}): back-fill, notes pulled from elsewhere,
 *   retries, re-checks.
 * - Removing a use is NEVER done here: a file can be on the same page twice (an
 *   attachment and a file block, one reference), and only Nilo knows when the
 *   page stops using it. Nilo removes its reference with its service token.
 * - A file not `active` (in its owner's trash, blocked) is never linked: Oxy
 *   restores a trashed file on a new reference, which would undo the owner's
 *   own decision. It is checked again later.
 * - A `linked` row is re-checked weekly and linked again unless the owner's own
 *   reference is there (one Nilo made with its token does not carry the grant).
 *
 * Every request is made as the viewer whose database this is, and abandoned the
 * moment the active account changes.
 */

import { getErrorStatus } from '@oxy.so/core';
import { createLogger } from '@oxy.so/core/logger';
import { NILO_FILE_ENTITY_TYPE, NILO_OXY_APPLICATION_ID } from '@oxy.so/nilo-contracts';

import type { Row, Statement } from '@/lib/db/client';

const logger = createLogger('NotedAttachmentLinks');

/** What a row says about one (note, file) pair. */
export type AttachmentLinkState =
  /** Not linked yet, or a re-check is due. */
  | 'pending'
  /** The owner's link to Nilo exists. */
  | 'linked'
  /** The file is not `active` (trash, blocked): not linked, checked again later. */
  | 'unavailable'
  /** The file does not exist any more. Final. */
  | 'missing'
  /** The file is another account's: only its owner can attach it to Nilo. Final. */
  | 'not_owner';

/** How long a confirmed link is trusted before it is checked again. */
export const LINK_RECHECK_MS = 7 * 24 * 60 * 60 * 1_000;
/** First retry of a failed request or an unavailable file; doubles from here. */
export const LINK_RETRY_BASE_MS = 60_000;
/** Longest wait between two tries. */
export const LINK_RETRY_MAX_MS = 24 * 60 * 60 * 1_000;
/** Most rows one sync works through, so a large back-fill spreads over passes. */
export const LINK_BATCH = 50;

/** Exponential backoff for a row that has failed `attempts` times, capped at a day. */
export function linkRetryDelayMs(attempts: number): number {
  const exponent = Math.min(Math.max(0, attempts - 1), 30);
  return Math.min(LINK_RETRY_BASE_MS * 2 ** exponent, LINK_RETRY_MAX_MS);
}

/** The reference this module makes: Nilo's use of the file on the note's page. */
export function niloPageTarget(noteId: string) {
  return { app: NILO_OXY_APPLICATION_ID, entityType: NILO_FILE_ENTITY_TYPE, entityId: noteId };
}

/** The attachments of live notes, read from the JSON column as SQLite sees it. */
const LIVE_ATTACHMENTS = `
  SELECT notes.id AS note_id, attachment.value AS file_id
  FROM notes, json_each(
    CASE WHEN json_valid(notes.attachments_json) THEN notes.attachments_json ELSE '[]' END
  ) AS attachment
  WHERE notes.deleted_at IS NULL AND attachment.type = 'text' AND attachment.value <> ''`;

/**
 * Bring `attachment_links` in line with the notes: add every attachment it does
 * not have as `pending`, drop every row whose attachment is gone.
 */
export function deriveAttachmentLinkStatements(now: string): Statement[] {
  return [
    {
      sql: `INSERT OR IGNORE INTO attachment_links (note_id, file_id, state, attempts, next_attempt_at)
            SELECT DISTINCT live.note_id, live.file_id, 'pending', 0, ?
            FROM (${LIVE_ATTACHMENTS}) AS live`,
      params: [now],
    },
    {
      sql: `DELETE FROM attachment_links WHERE NOT EXISTS (
              SELECT 1 FROM (${LIVE_ATTACHMENTS}) AS live
              WHERE live.note_id = attachment_links.note_id AND live.file_id = attachment_links.file_id
            )`,
    },
  ];
}

const DUE_LINKS_FROM = `
  SELECT attachment_links.note_id, attachment_links.file_id, attachment_links.state,
         attachment_links.attempts
  FROM attachment_links
  JOIN notes ON notes.id = attachment_links.note_id
  WHERE attachment_links.state IN ('pending', 'linked', 'unavailable')
    AND attachment_links.next_attempt_at <= ?
    AND notes.deleted_at IS NULL`;

/** Rows due for work, oldest first. */
export const DUE_LINKS_SQL = `${DUE_LINKS_FROM}
  ORDER BY attachment_links.next_attempt_at ASC
  LIMIT ${LINK_BATCH}`;

/** One note's rows due for work. */
export const DUE_NOTE_LINKS_SQL = `${DUE_LINKS_FROM}
    AND attachment_links.note_id = ?
  ORDER BY attachment_links.file_id ASC`;

export interface DueLinkRow extends Row {
  note_id: string;
  file_id: string;
  state: string;
  attempts: number;
}

/** The parts of an Oxy asset record this module reads (`GET /assets/:id`). */
export interface LinkedAssetRecord {
  ownerUserId?: string | null;
  status: string;
  links?: ReadonlyArray<{
    app: string;
    applicationId?: string;
    entityType: string;
    entityId: string;
    /** Absent on a reference an application made with its service token. */
    createdBy?: string;
  }>;
}

/** The two calls made with the owner's session (`OxyServices.assets`). */
export interface AttachmentAssets {
  get(fileId: string): Promise<{ file: LinkedAssetRecord }>;
  link(
    fileId: string,
    target: { app: string; entityType: string; entityId: string },
  ): Promise<unknown>;
}

/** What to write for a row once its file has been looked at. */
export interface LinkOutcome {
  state: AttachmentLinkState;
  /** When to look again; null for a final state. */
  retryInMs: number | null;
  attempts: number;
  error: string | null;
}

/**
 * The OWNER's reference of the file to the note's page. A reference Nilo made
 * with its token (no `createdBy`) is the same use but not the owner's grant
 * (ADR 0021), so it does not count: the owner links again.
 */
function hasOwnerNiloPageLink(file: LinkedAssetRecord, owner: string, noteId: string): boolean {
  return (file.links ?? []).some(
    (link) =>
      (link.applicationId ?? link.app) === NILO_OXY_APPLICATION_ID &&
      link.entityType === NILO_FILE_ENTITY_TYPE &&
      link.entityId === noteId &&
      link.createdBy === owner,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A failed request: retry with backoff, keeping what the row knew. */
function failed(row: DueLinkRow, error: unknown): LinkOutcome {
  const attempts = row.attempts + 1;
  return {
    state: row.state === 'linked' ? 'linked' : 'pending',
    retryInMs: linkRetryDelayMs(attempts),
    attempts,
    error: errorMessage(error),
  };
}

/**
 * Look at one attachment's file and link it to Nilo if it needs it.
 * `isCurrent` is asked after every request: once it says no, the answer
 * belongs to another account and nothing is concluded from it (`null`).
 */
export async function linkAttachment(
  assets: AttachmentAssets,
  viewerId: string,
  row: DueLinkRow,
  isCurrent: () => boolean,
): Promise<LinkOutcome | null> {
  let file: LinkedAssetRecord;
  try {
    file = (await assets.get(row.file_id)).file;
  } catch (error) {
    if (!isCurrent()) return null;
    if (getErrorStatus(error) === 404) {
      return { state: 'missing', retryInMs: null, attempts: 0, error: null };
    }
    return failed(row, error);
  }
  if (!isCurrent()) return null;

  if (file.status === 'deleted') {
    return { state: 'missing', retryInMs: null, attempts: 0, error: null };
  }
  if (file.ownerUserId && file.ownerUserId !== viewerId) {
    return { state: 'not_owner', retryInMs: null, attempts: 0, error: null };
  }
  if (file.status !== 'active') {
    const attempts = row.state === 'unavailable' ? row.attempts + 1 : 1;
    return {
      state: 'unavailable',
      retryInMs: linkRetryDelayMs(attempts),
      attempts,
      error: `file is ${file.status}`,
    };
  }
  if (hasOwnerNiloPageLink(file, file.ownerUserId ?? viewerId, row.note_id)) {
    return { state: 'linked', retryInMs: LINK_RECHECK_MS, attempts: 0, error: null };
  }

  try {
    await assets.link(row.file_id, niloPageTarget(row.note_id));
  } catch (error) {
    if (!isCurrent()) return null;
    const status = getErrorStatus(error);
    if (status === 404) return { state: 'missing', retryInMs: null, attempts: 0, error: null };
    if (status === 403) return { state: 'not_owner', retryInMs: null, attempts: 0, error: null };
    return failed(row, error);
  }
  if (!isCurrent()) return null;
  return { state: 'linked', retryInMs: LINK_RECHECK_MS, attempts: 0, error: null };
}

/** The row's new state, written only if the attachment is still there. */
export function outcomeStatement(row: DueLinkRow, outcome: LinkOutcome, now: Date): Statement {
  // A final state keeps a far-future time so the due query never picks it.
  const next =
    outcome.retryInMs === null
      ? '9999-12-31T00:00:00.000Z'
      : new Date(now.getTime() + outcome.retryInMs).toISOString();
  return {
    sql: `UPDATE attachment_links
          SET state = ?, attempts = ?, next_attempt_at = ?, last_error = ?, checked_at = ?
          WHERE note_id = ? AND file_id = ?`,
    params: [
      outcome.state,
      outcome.attempts,
      next,
      outcome.error,
      now.toISOString(),
      row.note_id,
      row.file_id,
    ],
  };
}

export interface AttachmentLinkDeps {
  assets: AttachmentAssets;
  execute: <T extends Row>(
    sql: string,
    params: readonly unknown[],
    viewerId: string,
  ) => Promise<T[]>;
  executeTransaction: (statements: readonly Statement[], viewerId: string) => Promise<unknown>;
  isCurrentViewer: (viewerId: string) => boolean;
  now?: () => Date;
}

/** Work through `due`, recording each outcome; stops if the account changes. */
async function workThrough(
  viewerId: string,
  due: readonly DueLinkRow[],
  deps: AttachmentLinkDeps,
  now: () => Date,
): Promise<{ linked: number; failed: number }> {
  let linked = 0;
  let failedCount = 0;
  for (const row of due) {
    if (!deps.isCurrentViewer(viewerId)) break;
    const outcome = await linkAttachment(deps.assets, viewerId, row, () =>
      deps.isCurrentViewer(viewerId),
    );
    if (!outcome) break;
    await deps.executeTransaction([outcomeStatement(row, outcome, now())], viewerId);
    if (outcome.state === 'linked') linked += 1;
    if (outcome.error && outcome.state !== 'unavailable') {
      failedCount += 1;
      logger.warn('Could not link an attachment to Nilo', {
        attempts: outcome.attempts,
        error: outcome.error,
      });
    }
  }
  return { linked, failed: failedCount };
}

/**
 * One pass: derive the rows from the notes, then work through the due ones.
 * A failure on one row is recorded on it and never stops the others.
 */
export async function syncAttachmentLinks(
  viewerId: string,
  deps: AttachmentLinkDeps,
): Promise<{ linked: number; failed: number }> {
  const now = deps.now ?? (() => new Date());
  if (!deps.isCurrentViewer(viewerId)) return { linked: 0, failed: 0 };
  await deps.executeTransaction(deriveAttachmentLinkStatements(now().toISOString()), viewerId);
  const due = await deps.execute<DueLinkRow>(DUE_LINKS_SQL, [now().toISOString()], viewerId);
  return workThrough(viewerId, due, deps, now);
}

/**
 * Link one note's due attachments, before the note is sent to Nilo. Never
 * throws: a link that failed is recorded on its row and retried, and the note
 * is sent anyway — holding a note's text back for a file link would trade a
 * rare missing grant for a lost edit.
 */
export async function linkNoteAttachments(
  viewerId: string,
  noteId: string,
  deps: AttachmentLinkDeps,
): Promise<{ linked: number; failed: number }> {
  const now = deps.now ?? (() => new Date());
  try {
    if (!deps.isCurrentViewer(viewerId)) return { linked: 0, failed: 0 };
    await deps.executeTransaction(deriveAttachmentLinkStatements(now().toISOString()), viewerId);
    const due = await deps.execute<DueLinkRow>(
      DUE_NOTE_LINKS_SQL,
      [now().toISOString(), noteId],
      viewerId,
    );
    return await workThrough(viewerId, due, deps, now);
  } catch (error) {
    logger.warn("Could not link a note's attachments before sending it", {
      error: errorMessage(error),
    });
    return { linked: 0, failed: 1 };
  }
}
