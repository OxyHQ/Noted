import type { LabelDTO, NoteDTO } from '@noted/shared-types';
import { normalizeNoteColor } from '@noted/shared-types';
import type { CatalogToolHandler, CatalogToolHandlers } from '@oxyhq/mcp';
import { isLiveEntityId, isUniqueViolation } from '@oxyhq/db';
import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from 'drizzle-orm';

import { getDb, type DatabaseOrTransaction } from '../db/postgres.js';
import { labels } from '../db/schema/labels.js';
import { notes } from '../db/schema/notes.js';
import { readGeneratedHalf } from '../lib/note-artifacts.js';
import { serializeLabel, serializeNote } from '../lib/serializers.js';
import {
  emitLabelCreated,
  emitLabelDeleted,
  emitLabelUpdated,
  emitNoteCreated,
  emitNoteUpdated,
} from '../socket.js';
import { executeIdempotently } from './capability-idempotency.js';
import { NOTED_CAPABILITY_CATALOG } from './noted.catalog.js';
import { publishNoteChangedEvent } from './noted.events.js';

export class NotedCapabilityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'NotedCapabilityError';
  }
}

type ToolExecutor = (
  input: Readonly<Record<string, unknown>>,
  accountId: string,
) => Promise<Record<string, unknown>>;

function requiredString(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new NotedCapabilityError('invalid_input', `${key} is required`, 400);
  }
  return value;
}

function optionalString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function requiredTrimmedString(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = requiredString(input, key).trim();
  if (!value) throw new NotedCapabilityError('invalid_input', `${key} cannot be blank`, 400);
  return value;
}

function requireEntityId(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = requiredString(input, key);
  if (!isLiveEntityId(value)) {
    throw new NotedCapabilityError('invalid_input', `${key} is not a valid id`, 400);
  }
  return value;
}

function idempotencyKey(input: Readonly<Record<string, unknown>>): string {
  return requiredString(input, 'idempotencyKey');
}

function stringArray(input: Readonly<Record<string, unknown>>, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new NotedCapabilityError('invalid_input', `${key} must be a string array`, 400);
  }
  return value;
}

async function assertLabelsBelongToAccount(
  db: DatabaseOrTransaction,
  accountId: string,
  labelIds: readonly string[],
): Promise<void> {
  const uniqueIds = [...new Set(labelIds)];
  if (uniqueIds.some((id) => !isLiveEntityId(id))) {
    throw new NotedCapabilityError('invalid_input', 'labelIds contains an invalid id', 400);
  }
  if (uniqueIds.length === 0) return;

  const owned = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.oxyUserId, accountId), inArray(labels.id, uniqueIds)));
  if (owned.length !== uniqueIds.length) {
    throw new NotedCapabilityError('label_not_found', 'One or more labels do not exist', 404);
  }
}

async function noteForAccount(
  db: DatabaseOrTransaction,
  accountId: string,
  noteId: string,
) {
  const [note] = await db
    .select()
    .from(notes)
    .where(and(
      eq(notes.id, noteId),
      eq(notes.oxyUserId, accountId),
      isNull(notes.deletedAt),
    ));
  if (!note) throw new NotedCapabilityError('note_not_found', 'Note not found', 404);
  return note;
}

async function searchNotes(
  input: Readonly<Record<string, unknown>>,
  accountId: string,
): Promise<{ notes: NoteDTO[] }> {
  const view = input.view === 'archived' || input.view === 'trashed' ? input.view : 'active';
  const filters = [eq(notes.oxyUserId, accountId), isNull(notes.deletedAt)];
  if (view === 'trashed') {
    filters.push(eq(notes.trashed, true));
  } else if (view === 'archived') {
    filters.push(eq(notes.trashed, false), eq(notes.archived, true));
  } else {
    filters.push(eq(notes.trashed, false), eq(notes.archived, false));
  }

  const labelId = optionalString(input, 'labelId');
  if (labelId) filters.push(arrayContains(notes.labels, [labelId]));
  if (typeof input.pinned === 'boolean') filters.push(eq(notes.pinned, input.pinned));
  const query = optionalString(input, 'query')?.trim();
  if (query) {
    filters.push(sql`${notes.searchVector} @@ plainto_tsquery('simple', ${query})`);
  }
  const limit = typeof input.limit === 'number' ? input.limit : 50;
  const rows = await getDb()
    .select()
    .from(notes)
    .where(and(...filters))
    .orderBy(desc(notes.pinned), asc(notes.sortOrder), desc(notes.updatedAt))
    .limit(limit);
  return { notes: rows.map((note) => serializeNote(note)) };
}

async function readNote(
  input: Readonly<Record<string, unknown>>,
  accountId: string,
): Promise<{ note: NoteDTO }> {
  const note = await noteForAccount(getDb(), accountId, requireEntityId(input, 'noteId'));
  const generated = await readGeneratedHalf([note.id], accountId);
  return {
    note: serializeNote(note, {
      artifacts: generated.artifacts.get(note.id) ?? [],
      overrides: generated.overrides.get(note.id) ?? [],
    }),
  };
}

async function createNote(
  input: Readonly<Record<string, unknown>>,
  accountId: string,
): Promise<{ note: NoteDTO }> {
  const labelsInput = stringArray(input, 'labelIds') ?? [];
  const execution = await executeIdempotently({
    accountId,
    tool: 'createNote',
    idempotencyKey: idempotencyKey(input),
    request: input,
    execute: async (transaction) => {
      await assertLabelsBelongToAccount(transaction, accountId, labelsInput);
      const reminderAt = input.reminderAt === null
        ? null
        : optionalString(input, 'reminderAt');
      const [note] = await transaction
        .insert(notes)
        .values({
          oxyUserId: accountId,
          title: optionalString(input, 'title') ?? '',
          body: optionalString(input, 'body') ?? '',
          color: normalizeNoteColor(input.color),
          labels: [...new Set(labelsInput)],
          reminderAt: reminderAt ? new Date(reminderAt) : null,
        })
        .returning();
      if (!note) throw new Error('Created note was not returned');
      return { note: serializeNote(note) };
    },
  });
  if (!execution.replayed) emitNoteCreated(accountId, execution.result.note);
  await publishNoteChangedEvent({
    accountId,
    noteId: execution.result.note.id,
    change: 'created',
    idempotencyKey: idempotencyKey(input),
    occurredAt: execution.result.note.updatedAt,
  });
  return execution.result;
}

async function updateNote(
  input: Readonly<Record<string, unknown>>,
  accountId: string,
): Promise<{ note: NoteDTO }> {
  const noteId = requireEntityId(input, 'noteId');
  const labelsInput = stringArray(input, 'labelIds');
  const execution = await executeIdempotently({
    accountId,
    tool: 'updateNote',
    idempotencyKey: idempotencyKey(input),
    request: input,
    execute: async (transaction) => {
      if (labelsInput) await assertLabelsBelongToAccount(transaction, accountId, labelsInput);
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof input.title === 'string') update.title = input.title;
      if (typeof input.body === 'string') update.body = input.body;
      if (input.color !== undefined) update.color = normalizeNoteColor(input.color);
      if (labelsInput) update.labels = [...new Set(labelsInput)];
      if (typeof input.pinned === 'boolean') update.pinned = input.pinned;
      if (Object.keys(update).length === 1) {
        throw new NotedCapabilityError('invalid_input', 'No note fields to update', 400);
      }
      const [note] = await transaction
        .update(notes)
        .set(update)
        .where(and(
          eq(notes.id, noteId),
          eq(notes.oxyUserId, accountId),
          isNull(notes.deletedAt),
        ))
        .returning();
      if (!note) throw new NotedCapabilityError('note_not_found', 'Note not found', 404);
      return { note: serializeNote(note) };
    },
  });
  if (!execution.replayed) emitNoteUpdated(accountId, execution.result.note);
  await publishNoteChangedEvent({
    accountId,
    noteId: execution.result.note.id,
    change: 'updated',
    idempotencyKey: idempotencyKey(input),
    occurredAt: execution.result.note.updatedAt,
  });
  return execution.result;
}

async function setNoteState(
  tool: 'archiveNote' | 'restoreNote',
  input: Readonly<Record<string, unknown>>,
  accountId: string,
): Promise<{ note: NoteDTO }> {
  const noteId = requireEntityId(input, 'noteId');
  const execution = await executeIdempotently({
    accountId,
    tool,
    idempotencyKey: idempotencyKey(input),
    request: input,
    execute: async (transaction) => {
      const state = tool === 'archiveNote'
        ? { archived: true, trashed: false }
        : { archived: false, trashed: false };
      const [note] = await transaction
        .update(notes)
        .set({ ...state, updatedAt: new Date() })
        .where(and(
          eq(notes.id, noteId),
          eq(notes.oxyUserId, accountId),
          isNull(notes.deletedAt),
        ))
        .returning();
      if (!note) throw new NotedCapabilityError('note_not_found', 'Note not found', 404);
      return { note: serializeNote(note) };
    },
  });
  if (!execution.replayed) emitNoteUpdated(accountId, execution.result.note);
  await publishNoteChangedEvent({
    accountId,
    noteId: execution.result.note.id,
    change: tool === 'archiveNote' ? 'archived' : 'restored',
    idempotencyKey: idempotencyKey(input),
    occurredAt: execution.result.note.updatedAt,
  });
  return execution.result;
}

async function listLabels(accountId: string): Promise<{ labels: LabelDTO[] }> {
  const rows = await getDb()
    .select()
    .from(labels)
    .where(eq(labels.oxyUserId, accountId))
    .orderBy(asc(labels.name));
  return { labels: rows.map(serializeLabel) };
}

async function createLabel(
  input: Readonly<Record<string, unknown>>,
  accountId: string,
): Promise<{ label: LabelDTO }> {
  try {
    const execution = await executeIdempotently({
      accountId,
      tool: 'createLabel',
      idempotencyKey: idempotencyKey(input),
      request: input,
      execute: async (transaction) => {
        const [label] = await transaction
          .insert(labels)
          .values({
            oxyUserId: accountId,
            name: requiredTrimmedString(input, 'name'),
            color: input.color === null ? null : normalizeNoteColor(input.color),
          })
          .returning();
        if (!label) throw new Error('Created label was not returned');
        return { label: serializeLabel(label) };
      },
    });
    if (!execution.replayed) emitLabelCreated(accountId, execution.result.label);
    return execution.result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new NotedCapabilityError('label_exists', 'A label with that name already exists', 409);
    }
    throw error;
  }
}

async function updateLabel(
  input: Readonly<Record<string, unknown>>,
  accountId: string,
): Promise<{ label: LabelDTO }> {
  const labelId = requireEntityId(input, 'labelId');
  try {
    const execution = await executeIdempotently({
      accountId,
      tool: 'updateLabel',
      idempotencyKey: idempotencyKey(input),
      request: input,
      execute: async (transaction) => {
        const update: Record<string, unknown> = { updatedAt: new Date() };
        if (typeof input.name === 'string') update.name = requiredTrimmedString(input, 'name');
        if (input.color === null) update.color = null;
        else if (input.color !== undefined) update.color = normalizeNoteColor(input.color);
        if (Object.keys(update).length === 1) {
          throw new NotedCapabilityError('invalid_input', 'No label fields to update', 400);
        }
        const [label] = await transaction
          .update(labels)
          .set(update)
          .where(and(eq(labels.id, labelId), eq(labels.oxyUserId, accountId)))
          .returning();
        if (!label) throw new NotedCapabilityError('label_not_found', 'Label not found', 404);
        return { label: serializeLabel(label) };
      },
    });
    if (!execution.replayed) emitLabelUpdated(accountId, execution.result.label);
    return execution.result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new NotedCapabilityError('label_exists', 'A label with that name already exists', 409);
    }
    throw error;
  }
}

async function deleteLabel(
  input: Readonly<Record<string, unknown>>,
  accountId: string,
): Promise<{ deleted: boolean; labelId: string }> {
  const labelId = requireEntityId(input, 'labelId');
  const execution = await executeIdempotently({
    accountId,
    tool: 'deleteLabel',
    idempotencyKey: idempotencyKey(input),
    request: input,
    execute: async (transaction) => {
      const [deleted] = await transaction
        .delete(labels)
        .where(and(eq(labels.id, labelId), eq(labels.oxyUserId, accountId)))
        .returning({ id: labels.id });
      if (deleted) {
        await transaction
          .update(notes)
          .set({ labels: sql`array_remove(${notes.labels}, ${labelId})`, updatedAt: new Date() })
          .where(and(eq(notes.oxyUserId, accountId), arrayContains(notes.labels, [labelId])));
      }
      return { deleted: Boolean(deleted), labelId };
    },
  });
  if (!execution.replayed && execution.result.deleted) emitLabelDeleted(accountId, labelId);
  return execution.result;
}

async function listReminders(
  input: Readonly<Record<string, unknown>>,
  accountId: string,
): Promise<{ notes: NoteDTO[] }> {
  const filters = [
    eq(notes.oxyUserId, accountId),
    isNull(notes.deletedAt),
    eq(notes.trashed, false),
    isNotNull(notes.reminderAt),
  ];
  const dueBefore = optionalString(input, 'dueBefore');
  if (dueBefore) filters.push(lte(notes.reminderAt, new Date(dueBefore)));
  if (input.includeDelivered !== true) filters.push(isNull(notes.reminderSentAt));
  const limit = typeof input.limit === 'number' ? input.limit : 50;
  const rows = await getDb()
    .select()
    .from(notes)
    .where(and(...filters))
    .orderBy(asc(notes.reminderAt))
    .limit(limit);
  return { notes: rows.map((note) => serializeNote(note)) };
}

async function setReminder(
  input: Readonly<Record<string, unknown>>,
  accountId: string,
): Promise<{ note: NoteDTO }> {
  const noteId = requireEntityId(input, 'noteId');
  const reminderAt = input.reminderAt === null
    ? null
    : new Date(requiredString(input, 'reminderAt'));
  const execution = await executeIdempotently({
    accountId,
    tool: 'setReminder',
    idempotencyKey: idempotencyKey(input),
    request: input,
    execute: async (transaction) => {
      const [note] = await transaction
        .update(notes)
        .set({ reminderAt, reminderSentAt: null, updatedAt: new Date() })
        .where(and(
          eq(notes.id, noteId),
          eq(notes.oxyUserId, accountId),
          isNull(notes.deletedAt),
        ))
        .returning();
      if (!note) throw new NotedCapabilityError('note_not_found', 'Note not found', 404);
      return { note: serializeNote(note) };
    },
  });
  if (!execution.replayed) emitNoteUpdated(accountId, execution.result.note);
  await publishNoteChangedEvent({
    accountId,
    noteId: execution.result.note.id,
    change: 'updated',
    idempotencyKey: idempotencyKey(input),
    occurredAt: execution.result.note.updatedAt,
  });
  return execution.result;
}

const TOOL_EXECUTORS: Readonly<Record<string, ToolExecutor>> = {
  searchNotes,
  readNote,
  createNote,
  updateNote,
  archiveNote: (input, accountId) => setNoteState('archiveNote', input, accountId),
  restoreNote: (input, accountId) => setNoteState('restoreNote', input, accountId),
  listLabels: (_input, accountId) => listLabels(accountId),
  createLabel,
  updateLabel,
  deleteLabel,
  listReminders,
  setReminder,
};

const catalogToolNames = NOTED_CAPABILITY_CATALOG.tools.map(({ name }) => name);
const missingExecutors = catalogToolNames.filter((name) => !TOOL_EXECUTORS[name]);
const extraExecutors = Object.keys(TOOL_EXECUTORS).filter((name) => !catalogToolNames.includes(name));
if (missingExecutors.length > 0 || extraExecutors.length > 0) {
  throw new Error(
    `Noted catalog handler mismatch: missing=${missingExecutors.join(',')} extra=${extraExecutors.join(',')}`,
  );
}

export async function executeNotedCatalogTool(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  effectiveAccountId: string,
): Promise<Record<string, unknown>> {
  const executor = TOOL_EXECUTORS[toolName];
  if (!executor) throw new NotedCapabilityError('unknown_tool', 'Unknown Noted tool', 404);
  return executor(input, effectiveAccountId);
}

export const NOTED_MCP_HANDLERS: CatalogToolHandlers = Object.fromEntries(
  Object.keys(TOOL_EXECUTORS).map((toolName) => {
    const handler: CatalogToolHandler = async (input, context) => ({
      structuredContent: await executeNotedCatalogTool(
        toolName,
        input,
        context.principal.accountId,
      ),
    });
    return [toolName, handler];
  }),
);
