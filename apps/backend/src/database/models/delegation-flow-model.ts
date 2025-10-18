import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for DelegationFlow documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface DelegationFlowFields {
  txId: string;
  timestamp: Date;
  fromAddress: string;
  toAddress: string;
  resource: 'ENERGY' | 'BANDWIDTH';
  permissionId?: number;
  rentalPeriodMinutes: number;
  amountTRX: number;
  normalizedAmountTRX: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mongoose document interface for DelegationFlow.
 * Extends both Document (for Mongoose methods) and DelegationFlowFields (for domain properties).
 */
export interface DelegationFlowDoc extends Document, DelegationFlowFields {}

const DelegationFlowSchema = new Schema<DelegationFlowDoc>(
  {
    txId: { type: String, required: true, unique: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    fromAddress: { type: String, required: true, index: true },
    toAddress: { type: String, required: true, index: true },
    resource: { type: String, required: true, enum: ['ENERGY', 'BANDWIDTH'] },
    permissionId: { type: Number },
    rentalPeriodMinutes: { type: Number, required: true },
    amountTRX: { type: Number, required: true },
    normalizedAmountTRX: { type: Number, required: true }
  },
  { timestamps: true, versionKey: false }
);

DelegationFlowSchema.index({ fromAddress: 1, toAddress: 1, timestamp: -1 });
DelegationFlowSchema.index({ normalizedAmountTRX: -1 });

export const DelegationFlowModel = model<DelegationFlowDoc>('DelegationFlow', DelegationFlowSchema);