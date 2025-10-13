import { Schema, model, type Document } from 'mongoose';

export type IgnoreScope = 'comments' | 'chat' | 'all';

export interface IgnoreEntryDoc extends Document {
  ownerWallet: string;
  ignoredWallet: string;
  scope: IgnoreScope;
  createdAt: Date;
}

const IgnoreEntrySchema = new Schema<IgnoreEntryDoc>({
  ownerWallet: { type: String, required: true, index: true },
  ignoredWallet: { type: String, required: true, index: true },
  scope: { type: String, required: true, enum: ['comments', 'chat', 'all'] }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

IgnoreEntrySchema.index({ ownerWallet: 1, ignoredWallet: 1, scope: 1 }, { unique: true });

export const IgnoreEntryModel = model<IgnoreEntryDoc>('IgnoreEntry', IgnoreEntrySchema);
