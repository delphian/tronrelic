import { Schema, model, type Document } from 'mongoose';
import type { TronTransactionDocument } from '@tronrelic/shared';

/**
 * Plain field interface for Transaction documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface TransactionFields extends Omit<TronTransactionDocument, 'id' | 'timestamp'> {
  timestamp: Date;
}

/**
 * Mongoose document interface for Transaction.
 * Extends both Document (for Mongoose methods) and TransactionFields (for domain properties).
 */
export interface TransactionDoc extends Document, TransactionFields {}

const TransactionSchema = new Schema<TransactionDoc>({
  txId: { type: String, index: true, unique: true, required: true },
  blockNumber: { type: Number, index: true, required: true },
  timestamp: { type: Date, index: true, required: true },
  type: { type: String, required: true },
  subType: String,
  from: {
    address: { type: String, required: true },
    name: String,
    type: { type: String, default: 'unknown' }
  },
  to: {
    address: { type: String, required: true },
    name: String,
    type: { type: String, default: 'unknown' }
  },
  amount: Number,
  amountTRX: Number,
  amountUSD: Number,
  energy: {
    consumed: Number,
    price: Number,
    totalCost: Number
  },
  bandwidth: {
    consumed: Number,
    price: Number,
    totalCost: Number
  },
  contract: {
    address: String,
    method: String,
    parameters: Schema.Types.Mixed
  },
  memo: String,
  internalTransactions: [Schema.Types.Mixed],
  indexed: { type: Date, default: Date.now },
  notifications: [String],
  analysis: {
    relatedAddresses: [String],
    relatedTransactions: [String],
    pattern: String,
    riskScore: Number,
    clusterId: String,
    confidence: Number
  }
}, { timestamps: true, versionKey: false });

TransactionSchema.index({ timestamp: -1 });
TransactionSchema.index({ 'analysis.pattern': 1 });
TransactionSchema.index({ 'analysis.clusterId': 1, timestamp: -1 });
TransactionSchema.index({ 'analysis.relatedTransactions': 1 });
TransactionSchema.index({ memo: 1, timestamp: -1 });
TransactionSchema.index({ 'internalTransactions.hash': 1 });
TransactionSchema.index({ type: 1, timestamp: -1 });
TransactionSchema.index({ 'from.address': 1, timestamp: -1 });
TransactionSchema.index({ 'to.address': 1, timestamp: -1 });

export const TransactionModel = model<TransactionDoc>('Transaction', TransactionSchema);
