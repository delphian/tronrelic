import { Schema, model, type Document } from 'mongoose';

export interface BlockStats {
  transfers: number;
  contractCalls: number;
  delegations: number;
  stakes: number;
  tokenCreations: number;
  internalTransactions: number;
  totalEnergyUsed: number;
  totalEnergyCost: number;
  totalBandwidthUsed: number;
}

/**
 * Plain field interface for Block documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface BlockFields {
  blockNumber: number;
  blockId: string;
  parentHash: string;
  witnessAddress: string;
  timestamp: Date;
  transactionCount: number;
  size?: number;
  stats: BlockStats;
  processedAt: Date;
}

/**
 * Mongoose document interface for Block.
 * Extends both Document (for Mongoose methods) and BlockFields (for domain properties).
 */
export interface BlockDoc extends Document, BlockFields {}

const BlockSchema = new Schema<BlockDoc>({
  blockNumber: { type: Number, required: true, unique: true, index: true },
  blockId: { type: String, required: true, unique: true },
  parentHash: { type: String, required: true },
  witnessAddress: { type: String, required: true },
  timestamp: { type: Date, required: true, index: true },
  transactionCount: { type: Number, default: 0 },
  size: Number,
  stats: {
    transfers: { type: Number, default: 0 },
    contractCalls: { type: Number, default: 0 },
    delegations: { type: Number, default: 0 },
    stakes: { type: Number, default: 0 },
    tokenCreations: { type: Number, default: 0 },
    internalTransactions: { type: Number, default: 0 },
    totalEnergyUsed: { type: Number, default: 0 },
    totalEnergyCost: { type: Number, default: 0 },
    totalBandwidthUsed: { type: Number, default: 0 }
  },
  // Indexed: SystemMonitorService samples the most recent blocks sorted by
  // processedAt; without this index that query collection-scans every block.
  processedAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false, timestamps: false });

// No compound secondary indexes. `witnessAddress_1_timestamp_-1` was removed
// after index-usage stats showed zero reads across 12.3 days of production
// uptime and a repo-wide audit found no consumer — `witnessAddress` is written
// on every block and never queried. Stage 7 of the sync pipeline upserts one
// block per block time, and the collection's index working set exceeds the
// WiredTiger cache, so an unused index is a cold-page fault on the write path
// rather than idle bytes. The field-level `blockNumber`, `blockId`, and
// `timestamp` indexes declared above remain. `blockId` stays `unique` even
// though nothing queries it: `blockNumber` already rejects two documents at the
// same height, while `blockId` rejects two carrying the same block hash — the
// guard that catches a block written under a wrong or shifted height.
// See migration 007_drop_unused_block_indexes.

export const BlockModel = model<BlockDoc>('Block', BlockSchema);
