import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for SunPumpToken documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface SunPumpTokenFields {
  txId: string;
  timestamp: Date;
  ownerAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenContract: string;
  channelId: string;
  threadId?: number;
  notifiedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mongoose document interface for SunPumpToken.
 * Extends both Document (for Mongoose methods) and SunPumpTokenFields (for domain properties).
 */
export interface SunPumpTokenDoc extends Document, SunPumpTokenFields {}

const SunPumpTokenSchema = new Schema<SunPumpTokenDoc>(
  {
    txId: { type: String, required: true, unique: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    ownerAddress: { type: String, required: true, index: true },
    tokenName: { type: String, required: true },
    tokenSymbol: { type: String, required: true },
    tokenContract: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    threadId: { type: Number },
    notifiedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true, versionKey: false }
);

SunPumpTokenSchema.index({ notifiedAt: 1, timestamp: 1 });

export const SunPumpTokenModel = model<SunPumpTokenDoc>('SunPumpToken', SunPumpTokenSchema);
