import { Schema, model, type Document } from 'mongoose';

export type MuteScope = 'comments' | 'chat' | 'all';

export interface MuteDoc extends Document {
  wallet: string;
  scope: MuteScope;
  reason?: string;
  expiresAt?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const MuteSchema = new Schema<MuteDoc>({
  wallet: { type: String, required: true },
  scope: { type: String, required: true, enum: ['comments', 'chat', 'all'] },
  reason: { type: String },
  expiresAt: { type: Date },
  createdBy: { type: String, required: true }
}, { timestamps: true, versionKey: false });

MuteSchema.index({ wallet: 1, scope: 1 }, { unique: true });
MuteSchema.index({ expiresAt: 1 }, { partialFilterExpression: { expiresAt: { $exists: true } } });

export const MuteModel = model<MuteDoc>('Mute', MuteSchema);
