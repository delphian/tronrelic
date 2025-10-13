import { Schema, model, type Document } from 'mongoose';

export interface MarketAffiliateDoc extends Document {
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
