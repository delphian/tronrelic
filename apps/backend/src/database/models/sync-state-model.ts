import { Schema, model, type Document } from 'mongoose';

export interface SyncStateDoc extends Document {
  key: string;
  cursor: Record<string, unknown>;
  updatedAt: Date;
  meta?: Record<string, unknown>;
}

const SyncStateSchema = new Schema<SyncStateDoc>({
  key: { type: String, required: true, unique: true },
  cursor: { type: Schema.Types.Mixed, required: true },
  meta: { type: Schema.Types.Mixed }
}, { timestamps: true, versionKey: false });

SyncStateSchema.index({ key: 1 });

export const SyncStateModel = model<SyncStateDoc>('SyncState', SyncStateSchema);
