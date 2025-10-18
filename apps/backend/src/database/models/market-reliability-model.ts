import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for MarketReliability documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface MarketReliabilityFields {
  guid: string;
  successCount: number;
  failureCount: number;
  reliability: number;
  emaAvailability?: number;
  lastSuccess?: Date;
  lastFailure?: Date;
  failureStreak: number;
  successStreak: number;
}

/**
 * Mongoose document interface for MarketReliability.
 * Extends both Document (for Mongoose methods) and MarketReliabilityFields (for domain properties).
 */
export interface MarketReliabilityDoc extends Document, MarketReliabilityFields {}

const MarketReliabilitySchema = new Schema<MarketReliabilityDoc>({
  guid: { type: String, required: true, unique: true },
  successCount: { type: Number, default: 0 },
  failureCount: { type: Number, default: 0 },
  reliability: { type: Number, default: 0 },
  emaAvailability: { type: Number },
  lastSuccess: { type: Date },
  lastFailure: { type: Date },
  failureStreak: { type: Number, default: 0 },
  successStreak: { type: Number, default: 0 }
}, { timestamps: true, versionKey: false });

MarketReliabilitySchema.index({ guid: 1 });

export const MarketReliabilityModel = model<MarketReliabilityDoc>('MarketReliability', MarketReliabilitySchema);
