import { Types } from 'mongoose';
import type {
  MarketAffiliateTracking,
  MarketBulkDiscount,
  MarketDocument,
  MarketPricePoint,
  MarketPricingSummary
} from '@tronrelic/shared';

export interface LeanMarketDoc extends Omit<MarketDocument, 'id' | 'lastUpdated'> {
  _id: Types.ObjectId;
  lastUpdated?: Date | string;
}

export function mapLeanMarketDoc(doc: LeanMarketDoc): MarketDocument {
  const lastUpdated = typeof doc.lastUpdated === 'string'
    ? doc.lastUpdated
    : doc.lastUpdated instanceof Date
    ? doc.lastUpdated.toISOString()
    : new Date().toISOString();

  const pricing: MarketPricingSummary | undefined = doc.pricing
    ? {
        unit: doc.pricing.unit as MarketPricingSummary['unit'],
        effectivePrice: doc.pricing.effectivePrice ?? doc.effectivePrice ?? 0,
        bestPrice: doc.pricing.bestPrice ?? doc.effectivePrice ?? 0,
        medianPrice: doc.pricing.medianPrice ?? undefined,
        averagePrice: doc.pricing.averagePrice ?? undefined,
        worstPrice: doc.pricing.worstPrice ?? undefined,
        sampleSize: doc.pricing.sampleSize ?? doc.orders?.length ?? 0,
        collectedAt: doc.pricing.collectedAt
          ? new Date(doc.pricing.collectedAt).toISOString()
          : lastUpdated,
        sources: (doc.pricing.sources ?? []).map(source => {
          const rawTimestamp = source.timestamp as Date | string | undefined;
          const timestamp = rawTimestamp instanceof Date
            ? rawTimestamp.toISOString()
            : typeof rawTimestamp === 'string'
            ? rawTimestamp
            : lastUpdated;

          return {
            source: source.source as MarketPricePoint['source'],
            durationMinutes: source.durationMinutes ?? undefined,
            energyAmount: source.energyAmount ?? undefined,
            price: source.price ?? 0,
            rawPrice: source.rawPrice ?? undefined,
            includesFees: source.includesFees ?? undefined,
            timestamp,
            notes: source.notes ?? undefined
          } satisfies MarketPricePoint;
        })
      }
    : undefined;

  const bulkDiscount: MarketBulkDiscount | undefined = doc.bulkDiscount
    ? {
        hasDiscount: Boolean(doc.bulkDiscount.hasDiscount),
        summary: doc.bulkDiscount.summary ?? undefined,
        tiers: (doc.bulkDiscount.tiers ?? []).map(tier => ({
          minEnergy: tier.minEnergy ?? 0,
          price: tier.price ?? 0,
          discountPercent: tier.discountPercent ?? 0
        }))
      }
    : undefined;

  const affiliateTracking: MarketAffiliateTracking | undefined = doc.affiliateTracking
    ? {
        link: doc.affiliateTracking.link,
        conversion: doc.affiliateTracking.conversion ?? undefined,
        trackingCode: doc.affiliateTracking.trackingCode,
        impressions: doc.affiliateTracking.impressions ?? undefined,
        clicks: doc.affiliateTracking.clicks ?? undefined,
        lastClickAt: doc.affiliateTracking.lastClickAt
          ? new Date(doc.affiliateTracking.lastClickAt).toISOString()
          : undefined
      }
    : undefined;

  return {
    id: doc._id.toString(),
    name: doc.name,
    guid: doc.guid,
    priority: doc.priority,
    energy: doc.energy,
    bandwidth: doc.bandwidth,
    addresses: doc.addresses,
    social: doc.social,
    siteLinks: doc.siteLinks,
    fees: doc.fees,
    orders: doc.orders,
    affiliate: doc.affiliate,
    description: doc.description,
    iconHtml: doc.iconHtml,
    contract: doc.contract,
    metadata: doc.metadata as Record<string, unknown> | undefined,
    lastUpdated,
    isActive: doc.isActive,
    reliability: doc.reliability,
    averageDeliveryTime: doc.averageDeliveryTime,
    supportedRegions: doc.supportedRegions,
    stats: doc.stats,
    availabilityPercent: doc.availabilityPercent,
    effectivePrice: doc.effectivePrice,
    pricingDetail: doc.pricingDetail,
    pricing,
    availabilityConfidence: doc.availabilityConfidence ?? undefined,
    bulkDiscount,
    affiliateTracking,
    isBestDeal: doc.isBestDeal
  } satisfies MarketDocument;
}
