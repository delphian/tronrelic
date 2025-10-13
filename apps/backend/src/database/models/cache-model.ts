import { Schema, model, type Document } from 'mongoose';

export interface CacheDoc<T = unknown> extends Document {
  key: string;
  value: T;
  expiresAt?: Date;
  tags?: string[];
}

const CacheSchema = new Schema<CacheDoc>({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date },
  tags: [String]
}, { timestamps: true, versionKey: false });

CacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $gt: new Date(0) } } });

export const CacheModel = model<CacheDoc>('Cache', CacheSchema);
