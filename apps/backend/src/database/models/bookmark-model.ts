import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for Bookmark documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface BookmarkFields {
  ownerWallet: string;
  targetWallet: string;
  label?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mongoose document interface for Bookmark.
 * Extends both Document (for Mongoose methods) and BookmarkFields (for domain properties).
 */
export interface BookmarkDoc extends Document, BookmarkFields {}

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
