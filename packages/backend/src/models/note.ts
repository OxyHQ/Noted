import mongoose, { Schema, Model, Document } from 'mongoose';
import { NOTE_COLORS, type NoteColor, type ChecklistItem } from '@noted/shared-types';

// The note color enum, the NoteColor type, the ChecklistItem shape, and
// normalizeNoteColor are the SHARED contract — they live in @noted/shared-types
// (the single source of truth for both backend and frontend). This model only
// keeps the mongoose-bound, Document-carrying interface + schemas below.

export interface INote extends Document {
  oxyUserId: mongoose.Types.ObjectId;
  title: string;
  body: string;
  checklist: ChecklistItem[];
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

const ChecklistItemSchema = new Schema<ChecklistItem>(
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
