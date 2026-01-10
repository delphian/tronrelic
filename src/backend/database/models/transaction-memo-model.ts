import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for TransactionMemo documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface TransactionMemoFields {
  txId: string;
  blockNumber: number;
  timestamp: Date;
  fromAddress: string;
  toAddress: string;
  memo: string;
  notifiedAt?: Date | null;
  channelId: string;
  threadId?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mongoose document interface for TransactionMemo.
 * Extends both Document (for Mongoose methods) and TransactionMemoFields (for domain properties).
 */
export interface TransactionMemoDoc extends Document, TransactionMemoFields {}

const TransactionMemoSchema = new Schema<TransactionMemoDoc>(
  {
    txId: { type: String, required: true, unique: true, index: true },
    blockNumber: { type: Number, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    fromAddress: { type: String, required: true, index: true },
    toAddress: { type: String, required: true, index: true },
    memo: { type: String, required: true },
    notifiedAt: { type: Date, default: null, index: true },
    channelId: { type: String, required: true },
    threadId: { type: Number }
  },
  { timestamps: true, versionKey: false }
);

TransactionMemoSchema.index({ notifiedAt: 1, timestamp: 1 });

export const TransactionMemoModel = model<TransactionMemoDoc>('TransactionMemo', TransactionMemoSchema);
