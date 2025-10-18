import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for MarketAffiliate documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface MarketAffiliateFields {
  guid: string;
  link: string;
  conversion?: string;
  trackingCode: string;
  impressions: number;
  clicks: number;
  lastClickAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mongoose document interface for MarketAffiliate.
 * Extends both Document (for Mongoose methods) and MarketAffiliateFields (for domain properties).
 */
export interface MarketAffiliateDoc extends Document, MarketAffiliateFields {}

const MarketAffiliateSchema = new Schema<MarketAffiliateDoc>({
  guid: { type: String, required: true, unique: true, index: true },
  link: { type: String, required: true },
  conversion: { type: String },
  trackingCode: { type: String, required: true },
  impressions: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  lastClickAt: { type: Date }
}, { timestamps: true, versionKey: false });

MarketAffiliateSchema.index({ trackingCode: 1 }, { unique: true });

export const MarketAffiliateModel = model<MarketAffiliateDoc>('MarketAffiliate', MarketAffiliateSchema);
