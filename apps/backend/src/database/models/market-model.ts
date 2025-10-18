import { Schema, model, type Document } from 'mongoose';
import type { MarketDocument } from '@tronrelic/shared';

/**
 * Plain field interface for Market documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface MarketFields extends Omit<MarketDocument, 'id' | 'lastUpdated'> {
  lastUpdated: Date;
}

/**
 * Mongoose document interface for Market.
 * Extends both Document (for Mongoose methods) and MarketFields (for domain properties).
 */
export interface MarketDoc extends Document, MarketFields {}

const MarketSchema = new Schema<MarketDoc>({
  name: { type: String, required: true },
  guid: { type: String, required: true, unique: true },
  priority: { type: Number, default: 0 },
  energy: {
    total: { type: Number, required: true },
    available: { type: Number, required: true },
    price: Number,
    minOrder: Number,
    maxOrder: Number,
    unit: String
  },
  bandwidth: {
    total: Number,
    available: Number,
    price: Number,
    unit: String
  },
  addresses: [
    {
      address: { type: String, required: true },
      type: { type: String },
      description: { type: String },
      labels: [String]
    }
  ],
  social: [
    {
      platform: String,
      link: String,
      icon: String,
      label: String,
      verified: Boolean
    }
  ],
  siteLinks: [
    {
      link: String,
      text: String,
      conversion: String
    }
  ],
  fees: Schema.Types.Mixed,
  affiliate: {
    link: String,
    commission: Number,
    cookieDuration: Number
  },
  orders: Schema.Types.Mixed,
  description: String,
  iconHtml: String,
  contract: String,
  metadata: Schema.Types.Mixed,
  lastUpdated: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  reliability: Number,
  averageDeliveryTime: Number,
  supportedRegions: [String],
  stats: {
    totalOrders24h: Number,
    totalVolume24h: Number,
    averageOrderSize: Number,
    successRate: Number,
    orderMaxBuyerAPY: Number,
    orderMaxSellerAPY: Number
  },
  availabilityPercent: Number,
  effectivePrice: Number,
  pricingDetail: Schema.Types.Mixed,
  pricing: {
    unit: String,
    effectivePrice: Number,
    bestPrice: Number,
    medianPrice: Number,
    averagePrice: Number,
    worstPrice: Number,
    sampleSize: Number,
    collectedAt: Date,
    sources: [
      {
        source: String,
        durationMinutes: Number,
        energyAmount: Number,
        price: Number,
        rawPrice: Number,
        includesFees: Boolean,
        timestamp: Date,
        notes: String
      }
    ]
  },
  availabilityConfidence: Number,
  bulkDiscount: {
    hasDiscount: Boolean,
    summary: String,
    tiers: [
      {
        minEnergy: Number,
        price: Number,
        discountPercent: Number
      }
    ]
  },
  affiliateTracking: {
    link: String,
    conversion: String,
    trackingCode: String,
    impressions: Number,
    clicks: Number,
    lastClickAt: Date
  },
  isBestDeal: { type: Boolean, default: false }
}, { timestamps: true, versionKey: false });

MarketSchema.index({ guid: 1 }, { unique: true });
MarketSchema.index({ isActive: 1, priority: 1 });

export const MarketModel = model<MarketDoc>('Market', MarketSchema);
