import { Schema, model, type Document } from 'mongoose';
import type { TronTransactionDocument } from '@/shared';

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
  // blockNumber is deliberately unindexed: no query filters transactions by
  // block, and on an 85M+ document collection every secondary index adds real
  // latency to the block-sync bulk upsert (see migration
  // 006_drop_unused_transaction_indexes).
  blockNumber: { type: Number, required: true },
  timestamp: { type: Date, index: true, required: true },
  type: { type: String, required: true },
  subType: String,
  status: String,
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
    pattern: String,
    riskScore: Number,
    confidence: Number
  }
}, { timestamps: true, versionKey: false });

// Secondary indexes are deliberately minimal. Every index key is maintained on
// each of the ~350 upserts per block, and with 85M+ documents the index working
// set dwarfs the WiredTiger cache — so unused indexes translate directly into
// disk-read-bound bulk-write latency. timestamp descending, analysis.pattern,
// memo+timestamp, internalTransactions.hash, and blockNumber were removed after
// index-usage stats showed zero reads (timestamp_1 already serves descending
// sorts via reverse traversal); see migration 006_drop_unused_transaction_indexes.
TransactionSchema.index({ type: 1, timestamp: -1 });
TransactionSchema.index({ 'from.address': 1, timestamp: -1 });
TransactionSchema.index({ 'to.address': 1, timestamp: -1 });

export const TransactionModel = model<TransactionDoc>('Transaction', TransactionSchema);
