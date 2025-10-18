import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for MarketPriceHistory documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface MarketPriceHistoryFields {
  guid: string;
  name: string;
  effectivePrice?: number;
  bestPrice?: number;
  averagePrice?: number;
  minUsdtTransferCost?: number;
  availabilityPercent?: number;
  availabilityConfidence?: number;
  sampleSize?: number;
  recordedAt: Date;
}

/**
 * Mongoose document interface for MarketPriceHistory.
 * Extends both Document (for Mongoose methods) and MarketPriceHistoryFields (for domain properties).
 */
export interface MarketPriceHistoryDoc extends Document, MarketPriceHistoryFields {}

const MarketPriceHistorySchema = new Schema<MarketPriceHistoryDoc>({
  guid: { type: String, required: true, index: true },
  name: { type: String, required: true },
  effectivePrice: { type: Number },
  bestPrice: { type: Number },
  averagePrice: { type: Number },
  minUsdtTransferCost: { type: Number },
  availabilityPercent: { type: Number },
  availabilityConfidence: { type: Number },
  sampleSize: { type: Number },
  recordedAt: { type: Date, default: () => new Date(), index: true }
}, { versionKey: false });

MarketPriceHistorySchema.index({ guid: 1, recordedAt: -1 });
MarketPriceHistorySchema.index({ recordedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

export const MarketPriceHistoryModel = model<MarketPriceHistoryDoc>('MarketPriceHistory', MarketPriceHistorySchema);
