import { Schema, model, type Document } from 'mongoose';

export interface BookmarkDoc extends Document {
  ownerWallet: string;
  targetWallet: string;
  label?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BookmarkSchema = new Schema<BookmarkDoc>(
  {
    ownerWallet: { type: String, required: true, index: true },
    targetWallet: { type: String, required: true },
    label: { type: String },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() }
  },
  { versionKey: false }
);

BookmarkSchema.index({ ownerWallet: 1, targetWallet: 1 }, { unique: true });
BookmarkSchema.pre('save', function bookmarkUpdate(next) {
  this.updatedAt = new Date();
  next();
});

export const BookmarkModel = model<BookmarkDoc>('Bookmark', BookmarkSchema);
