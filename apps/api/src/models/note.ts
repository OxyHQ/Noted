import mongoose, { Schema, Model, Document } from 'mongoose';

/**
 * The 12 note colors shared with the client. `default` means "no tint / app
 * surface"; the other 11 are exactly the standard (non-premium) Bloom color
 * presets (`@oxyhq/bloom/theme` `APP_COLOR_PRESETS`), so a note's tint is
 * derived from the canonical Bloom color system on the client.
 */
export const NOTE_COLORS = [
  'default',
  'teal',
  'blue',
  'green',
  'amber',
  'yellow',
  'red',
  'purple',
  'pink',
  'sky',
  'orange',
  'mint',
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

/**
 * Coerce any stored/incoming color string to a valid {@link NoteColor}.
 *
 * Legacy notes/labels may hold colors from the previous palette
 * (`darkblue`, `brown`, `gray`) that are no longer in the enum. Narrowing the
 * enum would otherwise make a `.save()`/PATCH of such a document fail
 * validation, so reads and writes funnel through here: legacy values map to
 * their closest current hue, and anything unrecognised falls back to
 * `default`. This keeps the API tolerant of old data without a migration.
 */
export function normalizeNoteColor(color: unknown): NoteColor {
  if (typeof color === 'string') {
    if ((NOTE_COLORS as readonly string[]).includes(color)) {
      return color as NoteColor;
    }
    const legacy: Record<string, NoteColor> = {
      darkblue: 'blue',
      brown: 'amber',
      gray: 'default',
    };
    if (color in legacy) return legacy[color];
  }
  return 'default';
}

export interface IChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface INote extends Document {
  oxyUserId: mongoose.Types.ObjectId;
  title: string;
  body: string;
  checklist: IChecklistItem[];
  color: NoteColor;
  labels: string[];
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  /** Oxy file-manager file IDs (any file type). Bytes live in Oxy storage, not Noted. */
  attachments: string[];
  reminderAt: Date | null;
  /** Set once the current reminder has been delivered — keeps the sweep idempotent. */
  reminderSentAt: Date | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const ChecklistItemSchema = new Schema<IChecklistItem>(
  {
    id: { type: String, required: true },
    text: { type: String, default: '' },
    checked: { type: Boolean, default: false },
  },
  { _id: false },
);

const NoteSchema = new Schema<INote>(
  {
    oxyUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, default: '', trim: true, maxlength: 1000 },
    body: { type: String, default: '', maxlength: 100_000 },
    checklist: { type: [ChecklistItemSchema], default: [] },
    color: { type: String, enum: NOTE_COLORS, default: 'default' },
    // Label ids as strings to match the client DTO contract (labels: string[]).
    labels: { type: [String], default: [], index: true },
    pinned: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    trashed: { type: Boolean, default: false },
    // Oxy file-manager file IDs (any file type: image, PDF, doc, audio, video, …).
    attachments: { type: [String], default: [] },
    reminderAt: { type: Date, default: null },
    reminderSentAt: { type: Date, default: null },
    order: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

// Primary feed query: a user's notes by view (trashed/archived), pinned-first, by explicit order.
NoteSchema.index({ oxyUserId: 1, trashed: 1, archived: 1, pinned: -1, order: 1 });
// Full-text search across title + body (drives ?q=).
NoteSchema.index({ title: 'text', body: 'text' }, { weights: { title: 3, body: 1 }, name: 'note_text_search' });
// Reminder sweep: find due, undelivered reminders quickly.
NoteSchema.index({ reminderAt: 1, reminderSentAt: 1 });

export const Note: Model<INote> =
  mongoose.models.Note || mongoose.model<INote>('Note', NoteSchema);
