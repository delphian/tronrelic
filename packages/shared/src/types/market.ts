import type { AddressMetadata } from './common.js';
import type { MarketPricingDetail } from './market-pricing-matrix.js';

export interface MarketEnergyStats {
  total: number;
  available: number;
  price?: number;
  minOrder?: number;
  maxOrder?: number;
  unit?: string;
}

export interface MarketBandwidthStats {
  total: number;
  available: number;
  price?: number;
  unit?: string;
}

export interface MarketFee {
  minutes?: number;
  sun?: number;
  apy?: number;
  minBorrow?: number;
  maxBorrow?: number;
  description?: string;
  type?: string;
  energyAmount?: number; // Energy amount this fee applies to (e.g., 1_000_000)
}

export interface MarketOrder {
  energy: number;
  created?: number | null;
  duration: number;
  payment: number;
  buyerAPY?: number;
  sellerAPY?: number;
}

export interface MarketSocialLink {
  platform: string;
  link: string;
  icon?: string;
  label?: string;
  verified?: boolean;
}

export interface MarketSiteLink {
  link: string;
  text?: string;
  conversion?: string;
}

export interface MarketAffiliateInfo {
  link: string;
  commission?: number;
  cookieDuration?: number;
}

export interface MarketStats {
  totalOrders24h?: number;
  totalVolume24h?: number;
  averageOrderSize?: number;
  successRate?: number;
  orderMaxBuyerAPY?: number;
  orderMaxSellerAPY?: number;
}

export type MarketPriceUnit = 'trx_per_32000_energy_per_day';

export interface MarketPricePoint {
  source: 'order' | 'fee' | 'manual';
  durationMinutes?: number;
  energyAmount?: number;
  price: number;
  rawPrice?: number;
  includesFees?: boolean;
  timestamp: string;
  notes?: string;
}

export interface MarketPricingSummary {
  unit: MarketPriceUnit;
  effectivePrice: number;
  bestPrice: number;
  medianPrice?: number;
  averagePrice?: number;
  worstPrice?: number;
  sampleSize: number;
  sources: MarketPricePoint[];
  collectedAt: string;
}

export interface MarketBulkDiscountTier {
  minEnergy: number;
  price: number;
  discountPercent: number;
}

export interface MarketBulkDiscount {
  hasDiscount: boolean;
  summary?: string;
  tiers?: MarketBulkDiscountTier[];
}

export interface MarketAffiliateTracking {
  link: string;
  conversion?: string;
  trackingCode: string;
  impressions?: number;
  clicks?: number;
  lastClickAt?: string;
}

export interface MarketPriceHistoryEntry {
  recordedAt: string;
  effectivePrice?: number;
  bestPrice?: number;
  averagePrice?: number;
  minUsdtTransferCost?: number;
  availabilityPercent?: number;
  availabilityConfidence?: number;
  sampleSize?: number;
}

export interface MarketComparisonStats {
  totalMarkets: number;
  averagePrice?: number;
  medianPrice?: number;
  bestPrice?: number;
  worstPrice?: number;
}

export interface MarketComparisonResult {
  markets: MarketDocument[];
  stats: MarketComparisonStats;
}

export interface MarketDocument {
  id?: string;
  name: string;
  guid: string;
  priority: number;
  energy: MarketEnergyStats;
  bandwidth?: MarketBandwidthStats;
  addresses: AddressMetadata[];
  social?: MarketSocialLink[];
  siteLinks?: MarketSiteLink[];
  fees?: MarketFee[];
  orders?: MarketOrder[];
  affiliate?: MarketAffiliateInfo;
  description?: string;
  iconHtml?: string;
  contract?: string;
  metadata?: Record<string, unknown>;
  lastUpdated: string;
  isActive: boolean;
  reliability?: number;
  averageDeliveryTime?: number;
  supportedRegions?: string[];
  stats?: MarketStats;
  availabilityPercent?: number;
  effectivePrice?: number;
  pricing?: MarketPricingSummary;
  availabilityConfidence?: number;
  bulkDiscount?: MarketBulkDiscount;
  affiliateTracking?: MarketAffiliateTracking;
  isBestDeal?: boolean;
  pricingDetail?: MarketPricingDetail;
}

export interface MarketUpdateEvent {
  market: MarketDocument;
  previous?: MarketDocument;
  diff?: Record<string, unknown>;
}
