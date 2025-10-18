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
  processedAt: { type: Date, default: Date.now }
}, { versionKey: false, timestamps: false });

BlockSchema.index({ witnessAddress: 1, timestamp: -1 });

export const BlockModel = model<BlockDoc>('Block', BlockSchema);
