import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for Cache documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface CacheFields<T = unknown> {
  key: string;
  value: T;
  expiresAt?: Date;
  tags?: string[];
}

/**
 * Mongoose document interface for Cache.
 * Extends both Document (for Mongoose methods) and CacheFields (for domain properties).
 */
export interface CacheDoc<T = unknown> extends Document, CacheFields<T> {}

const CacheSchema = new Schema<CacheDoc>({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date },
  tags: [String]
}, { timestamps: true, versionKey: false });

CacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $gt: new Date(0) } } });

export const CacheModel = model<CacheDoc>('Cache', CacheSchema);
