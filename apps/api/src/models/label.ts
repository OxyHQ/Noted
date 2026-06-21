import mongoose, { Schema, Model, Document } from 'mongoose';
import { NOTE_COLORS, type NoteColor } from './note.js';

export interface ILabel extends Document {
  oxyUserId: mongoose.Types.ObjectId;
  name: string;
  color: NoteColor | null;
  createdAt: Date;
  updatedAt: Date;
}

const LabelSchema = new Schema<ILabel>(
  {
    oxyUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    color: { type: String, enum: [...NOTE_COLORS, null], default: null },
  },
  {
    timestamps: true,
  },
);

// A user cannot have two labels with the same name; also the primary "list my labels" index.
LabelSchema.index({ oxyUserId: 1, name: 1 }, { unique: true });

export const Label: Model<ILabel> =
  mongoose.models.Label || mongoose.model<ILabel>('Label', LabelSchema);
