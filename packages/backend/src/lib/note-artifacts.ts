/**
 * The generated half of a note, on its way to and from the database.
 *
 * A note's body is Markdown, and Markdown has forgotten which sentence came from
 * which second of the recording, which line the user rewrote, and which revision
 * of the transcript a claim was checked against. Storing only the body is what
 * made a recording device-local: open the same note on a laptop and the text is
 * there with none of the evidence behind it.
 *
 * ## The write is a compare-and-swap, in SQL
 *
 * A device that has been offline holds an artifact built from an older
 * transcript. Its view of the recording is missing whatever changed the answer,
 * so it must not win — and the check cannot live in application code, because a
 * request that has been waiting on the event loop for 200 ms would then beat a
 * fresher one by winning a race between a read and a write. The guard is a
 * `WHERE` clause on the upsert: the database refuses the write in the same
 * statement that would have performed it.
 *
 * This mirrors `lib/db/artifacts-repo.ts` on the device, deliberately. The same
 * rule enforced in two places by two different mechanisms would be two rules.
 */

import { z } from 'zod';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { CAPTURE_PROFILES, DOCUMENT_INTENTS } from '@noted/shared-types';
import type { GeneratedNoteArtifact, UserItemOverride } from '@noted/shared-types';

import { getDb } from '../db/postgres.js';
import {
  noteArtifacts,
  noteItemOverrides,
  type ArtifactDocument,
} from '../db/schema/note-artifacts.js';

/**
 * How much generated document one note may carry.
 *
 * An hour of speech produces a few tens of kilobytes of artifact; this is room
 * for a very long recording and still small enough that a client cannot use a
 * note as free storage.
 */
const MAX_DOCUMENT_BYTES = 512 * 1024;

/** How many recordings one note may hold artifacts for. */
const MAX_ARTIFACTS_PER_NOTE = 50;

/** How many edited items one note may carry. */
const MAX_OVERRIDES_PER_NOTE = 5_000;

const sourceRangeSchema = z.object({
  captureId: z.string().max(64),
  startMs: z.number(),
  endMs: z.number(),
  segmentIds: z.array(z.string().max(128)).max(500),
});

const itemStatusSchema = z.enum(['active', 'resolved', 'superseded', 'removed']);
const itemOriginSchema = z.enum([
  'transcript',
  'explicit-instruction',
  'derived-from-instruction',
  'legacy',
]);

const generatedItemSchema = z.object({
  id: z.string().max(128),
  text: z.string().max(20_000),
  status: itemStatusSchema,
  origin: itemOriginSchema,
  sources: z.array(sourceRangeSchema).max(200),
  instructionSource: sourceRangeSchema.optional(),
  derivationReason: z.string().max(2_000).optional(),
});

const listItemSchema = z.object({
  id: z.string().max(128),
  text: z.string().max(20_000),
  status: itemStatusSchema,
  origin: itemOriginSchema,
  sources: z.array(sourceRangeSchema).max(200),
});

const blockBase = {
  id: z.string().max(128),
  status: itemStatusSchema,
  origin: itemOriginSchema,
  sources: z.array(sourceRangeSchema).max(200),
  instructionSource: sourceRangeSchema.optional(),
  derivationReason: z.string().max(2_000).optional(),
};

/**
 * A block, validated as the discriminated union it is.
 *
 * Not `z.object({ kind: z.enum([...]), text: z.string().optional(), items:
 * ... })`: that shape accepts a paragraph with no text and a list with none of
 * its lines, which renders as a note with holes in it and no error anywhere.
 */
const blockSchema = z.discriminatedUnion('kind', [
  z.object({ ...blockBase, kind: z.literal('paragraph'), text: z.string().max(50_000) }),
  z.object({
    ...blockBase,
    kind: z.literal('bullet-list'),
    items: z.array(listItemSchema).max(1_000),
  }),
  z.object({
    ...blockBase,
    kind: z.literal('numbered-list'),
    items: z.array(listItemSchema).max(1_000),
  }),
  z.object({
    ...blockBase,
    kind: z.literal('quote'),
    text: z.string().max(50_000),
    attribution: z.string().max(500).optional(),
  }),
]);

const sectionSchema = z.object({
  id: z.string().max(128),
  kind: z.enum(['notes', 'concepts', 'examples', 'ideas', 'decisions', 'takeaways', 'custom']),
  heading: z.string().max(500).optional(),
  blocks: z.array(blockSchema).max(2_000),
});

const personSchema = z.object({
  id: z.string().max(128),
  name: z.string().max(200).optional(),
  role: z.string().max(200).optional(),
  organization: z.string().max(200).optional(),
  sources: z.array(sourceRangeSchema).max(200),
});

const checklistSchema = z.object({
  id: z.string().max(128),
  kind: z.enum(['actions', 'shopping', 'packing', 'steps', 'custom']),
  heading: z.string().max(500).optional(),
  items: z
    .array(
      generatedItemSchema.extend({
        checked: z.boolean(),
        quantity: z.string().max(200).optional(),
        category: z.string().max(200).optional(),
        owner: z.string().max(200).optional(),
        dueAt: z.string().max(64).optional(),
      }),
    )
    .max(2_000),
});

/**
 * One artifact as a client sends it.
 *
 * `stage` is accepted and required to be `final`, rather than being left out of
 * the contract: a client that uploads a live artifact is doing something wrong,
 * and a 400 says so where a silently ignored field would not.
 */
export const artifactWriteSchema = z.object({
  id: z.string().max(128),
  noteId: z.string().max(128),
  captureId: z.string().max(64),
  stage: z.literal('final'),
  profile: z.enum(CAPTURE_PROFILES),
  intent: z.enum(DOCUMENT_INTENTS),
  transcriptRevision: z.number().int().min(0),
  artifactRevision: z.number().int().min(0),
  title: generatedItemSchema.optional(),
  sections: z.array(sectionSchema).max(500),
  people: z.array(personSchema).max(200).optional(),
  checklists: z.array(checklistSchema).max(100),
  openQuestions: z.array(generatedItemSchema).max(1_000),
  pendingExpansions: z
    .array(z.object({ subject: z.string().max(1_000), instructionSource: sourceRangeSchema }))
    .max(200)
    .optional(),
  createdAt: z.string().max(64),
  updatedAt: z.string().max(64),
});

export const overrideWriteSchema = z.object({
  itemId: z.string().max(128),
  text: z.string().max(50_000).nullable(),
  checked: z.boolean().nullable(),
  removed: z.boolean(),
  adopted: z.boolean(),
});

export const artifactsWriteSchema = z.array(artifactWriteSchema).max(MAX_ARTIFACTS_PER_NOTE);
export const overridesWriteSchema = z.array(overrideWriteSchema).max(MAX_OVERRIDES_PER_NOTE);

type ArtifactWrite = z.infer<typeof artifactWriteSchema>;

/** Whether a document is small enough to keep. */
function withinSizeLimit(document: ArtifactDocument): boolean {
  return Buffer.byteLength(JSON.stringify(document), 'utf8') <= MAX_DOCUMENT_BYTES;
}

/**
 * Store the artifacts a client sent for one note.
 *
 * Returns the ids it refused, so the caller can say so rather than reporting a
 * success the device would then stop retrying.
 */
export async function upsertArtifacts(
  noteId: string,
  userId: string,
  incoming: readonly ArtifactWrite[],
): Promise<{ rejected: string[] }> {
  const rejected: string[] = [];

  for (const artifact of incoming) {
    const document: ArtifactDocument = {
      title: artifact.title,
      sections: artifact.sections,
      people: artifact.people,
      checklists: artifact.checklists,
      openQuestions: artifact.openQuestions,
      pendingExpansions: artifact.pendingExpansions,
    };

    if (!withinSizeLimit(document)) {
      rejected.push(artifact.id);
      continue;
    }

    const [row] = await getDb()
      .insert(noteArtifacts)
      .values({
        id: artifact.id,
        noteId,
        oxyUserId: userId,
        captureId: artifact.captureId,
        profile: artifact.profile,
        intent: artifact.intent,
        transcriptRevision: artifact.transcriptRevision,
        artifactRevision: artifact.artifactRevision,
        doc: document,
      })
      .onConflictDoUpdate({
        target: [noteArtifacts.noteId, noteArtifacts.captureId],
        set: {
          profile: artifact.profile,
          intent: artifact.intent,
          transcriptRevision: artifact.transcriptRevision,
          artifactRevision: artifact.artifactRevision,
          doc: document,
          updatedAt: new Date(),
        },
        // The compare-and-swap. A transcript at least as new may land — the same
        // revision re-sent is an idempotent retry, which offline clients do — but
        // an older one never overwrites what a fresher pass already wrote.
        setWhere: sql`${noteArtifacts.transcriptRevision} <= ${artifact.transcriptRevision}`,
      })
      .returning({ id: noteArtifacts.id });

    if (!row) rejected.push(artifact.id);
  }

  return { rejected };
}

/**
 * Store what the user did to generated items.
 *
 * No revision guard, and that is not an oversight: an override records a human
 * action, and the last one a human took is the one that counts. The generated
 * side is what has revisions, because it is the side a machine rewrites.
 */
export async function upsertOverrides(
  noteId: string,
  userId: string,
  incoming: readonly UserItemOverride[],
): Promise<void> {
  if (incoming.length === 0) return;

  await getDb()
    .insert(noteItemOverrides)
    .values(
      incoming.map((override) => ({
        noteId,
        oxyUserId: userId,
        itemId: override.itemId,
        text: override.text,
        checked: override.checked,
        removed: override.removed,
        adopted: override.adopted,
      })),
    )
    .onConflictDoUpdate({
      target: [noteItemOverrides.noteId, noteItemOverrides.itemId],
      set: {
        text: sql`excluded.text`,
        checked: sql`excluded.checked`,
        removed: sql`excluded.removed`,
        adopted: sql`excluded.adopted`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Notes whose generated half moved, even though the note itself did not.
 *
 * The sync cursor is `notes.updatedAt`, and an artifact can change without it:
 * a phone that finishes the model pass writes only the artifact, and a laptop
 * pulling changes would then never learn the note it already has now has
 * structure behind it. Today the client happens to write the body at the same
 * moment, so this rarely fires — which is exactly why it must exist rather than
 * be assumed, since the day it stops being true nothing would report it.
 */
export async function notesWithGeneratedChangesSince(
  userId: string,
  since: Date,
): Promise<string[]> {
  const [artifactRows, overrideRows] = await Promise.all([
    getDb()
      .selectDistinct({ noteId: noteArtifacts.noteId })
      .from(noteArtifacts)
      .where(and(eq(noteArtifacts.oxyUserId, userId), gt(noteArtifacts.updatedAt, since))),
    getDb()
      .selectDistinct({ noteId: noteItemOverrides.noteId })
      .from(noteItemOverrides)
      .where(
        and(eq(noteItemOverrides.oxyUserId, userId), gt(noteItemOverrides.updatedAt, since)),
      ),
  ]);

  return [...new Set([...artifactRows, ...overrideRows].map((row) => row.noteId))];
}

/** What a note read needs, for a set of notes, in one query each. */
export async function readGeneratedHalf(
  noteIds: readonly string[],
  userId: string,
): Promise<{
  artifacts: Map<string, GeneratedNoteArtifact[]>;
  overrides: Map<string, UserItemOverride[]>;
}> {
  const artifacts = new Map<string, GeneratedNoteArtifact[]>();
  const overrides = new Map<string, UserItemOverride[]>();
  if (noteIds.length === 0) return { artifacts, overrides };

  const [artifactRows, overrideRows] = await Promise.all([
    getDb()
      .select()
      .from(noteArtifacts)
      .where(
        and(inArray(noteArtifacts.noteId, [...noteIds]), eq(noteArtifacts.oxyUserId, userId)),
      ),
    getDb()
      .select()
      .from(noteItemOverrides)
      .where(
        and(
          inArray(noteItemOverrides.noteId, [...noteIds]),
          eq(noteItemOverrides.oxyUserId, userId),
        ),
      ),
  ]);

  for (const row of artifactRows) {
    const list = artifacts.get(row.noteId) ?? [];
    list.push({
      id: row.id,
      noteId: row.noteId,
      captureId: row.captureId,
      stage: 'final',
      profile: row.profile,
      intent: row.intent,
      transcriptRevision: row.transcriptRevision,
      artifactRevision: row.artifactRevision,
      title: row.doc.title,
      sections: row.doc.sections ?? [],
      people: row.doc.people,
      checklists: row.doc.checklists ?? [],
      openQuestions: row.doc.openQuestions ?? [],
      pendingExpansions: row.doc.pendingExpansions,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
    artifacts.set(row.noteId, list);
  }

  for (const row of overrideRows) {
    const list = overrides.get(row.noteId) ?? [];
    list.push({
      itemId: row.itemId,
      text: row.text,
      checked: row.checked,
      removed: row.removed,
      adopted: row.adopted,
    });
    overrides.set(row.noteId, list);
  }

  return { artifacts, overrides };
}

/**
 * Drop everything generated for a note.
 *
 * Called when a note is deleted forever. The foreign key would eventually do
 * this, but not for a month: deletion tombstones the note and clears its
 * content, and the row itself is only swept later. Leaving the artifact behind
 * would leave the transcript-derived text of a note the user deleted sitting in
 * the database for that whole window.
 */
export async function deleteGeneratedHalf(noteId: string, userId: string): Promise<void> {
  await Promise.all([
    getDb()
      .delete(noteArtifacts)
      .where(and(eq(noteArtifacts.noteId, noteId), eq(noteArtifacts.oxyUserId, userId))),
    getDb()
      .delete(noteItemOverrides)
      .where(and(eq(noteItemOverrides.noteId, noteId), eq(noteItemOverrides.oxyUserId, userId))),
  ]);
}
