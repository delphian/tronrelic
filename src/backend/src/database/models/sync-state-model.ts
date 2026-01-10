import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for SyncState documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface SyncStateFields {
  key: string;
  cursor: Record<string, unknown>;
  updatedAt: Date;
  meta?: Record<string, unknown>;
}

/**
 * Mongoose document interface for SyncState.
 * Extends both Document (for Mongoose methods) and SyncStateFields (for domain properties).
 */
export interface SyncStateDoc extends Document, SyncStateFields {}

const SyncStateSchema = new Schema<SyncStateDoc>({
  key: { type: String, required: true, unique: true },
  cursor: { type: Schema.Types.Mixed, required: true },
  meta: { type: Schema.Types.Mixed }
}, { timestamps: true, versionKey: false });

SyncStateSchema.index({ key: 1 });

export const SyncStateModel = model<SyncStateDoc>('SyncState', SyncStateSchema);
