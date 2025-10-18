import { Schema, model, type Document } from 'mongoose';

type ReliabilityStatus = 'success' | 'failure';

/**
 * Plain field interface for MarketReliabilityHistory documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface MarketReliabilityHistoryFields {
  guid: string;
  status: ReliabilityStatus;
  reliability?: number;
  availabilityPercent?: number;
  effectivePrice?: number;
  failureReason?: string;
  recordedAt: Date;
}

/**
 * Mongoose document interface for MarketReliabilityHistory.
 * Extends both Document (for Mongoose methods) and MarketReliabilityHistoryFields (for domain properties).
 */
export interface MarketReliabilityHistoryDoc extends Document, MarketReliabilityHistoryFields {}

const MarketReliabilityHistorySchema = new Schema<MarketReliabilityHistoryDoc>({
  guid: { type: String, required: true, index: true },
  status: { type: String, enum: ['success', 'failure'], required: true },
  reliability: { type: Number },
  availabilityPercent: { type: Number },
  effectivePrice: { type: Number },
  failureReason: { type: String },
  recordedAt: { type: Date, default: () => new Date(), index: true }
}, { versionKey: false });

MarketReliabilityHistorySchema.index({ guid: 1, recordedAt: -1 });
MarketReliabilityHistorySchema.index({ recordedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const MarketReliabilityHistoryModel = model<MarketReliabilityHistoryDoc>(
  'MarketReliabilityHistory',
  MarketReliabilityHistorySchema
);
