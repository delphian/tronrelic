import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for ContractActivity documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface ContractActivityFields {
  contractAddress: string;
  method?: string;
  date: Date;
  callCount: number;
  uniqueCallers: number;
  totalTRX: number;
  totalUSD?: number;
  totalEnergy?: number;
  lastActivityAt: Date;
  lastTxId: string;
  callers?: string[];
  updatedAt: Date;
  createdAt: Date;
}

/**
 * Mongoose document interface for ContractActivity.
 * Extends both Document (for Mongoose methods) and ContractActivityFields (for domain properties).
 */
export interface ContractActivityDoc extends Document, ContractActivityFields {}

const ContractActivitySchema = new Schema<ContractActivityDoc>(
  {
    contractAddress: { type: String, required: true },
    method: { type: String },
    date: { type: Date, required: true },
    callCount: { type: Number, default: 0 },
    uniqueCallers: { type: Number, default: 0 },
    totalTRX: { type: Number, default: 0 },
    totalUSD: { type: Number, default: 0 },
    totalEnergy: { type: Number, default: 0 },
    lastActivityAt: { type: Date, required: true },
    lastTxId: { type: String, required: true },
    callers: { type: [String], default: [] }
  },
  { timestamps: true, versionKey: false }
);

ContractActivitySchema.index({ contractAddress: 1, method: 1, date: 1 }, { unique: true });
ContractActivitySchema.index({ date: -1, callCount: -1 });
ContractActivitySchema.index({ totalTRX: -1 });

export const ContractActivityModel = model<ContractActivityDoc>('ContractActivity', ContractActivitySchema);