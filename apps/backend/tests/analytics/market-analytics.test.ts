import { describe, expect, it } from 'vitest';
import type { MarketSnapshot } from '../../src/modules/markets/dtos/market-snapshot.dto';
import { MarketAnalytics } from '../../src/modules/markets/market-analytics';

const baseSnapshot: MarketSnapshot = {
  guid: 'test-market',
  name: 'Test Market',
  priority: 1,
  energy: {
    total: 1_000_000,
    available: 750_000,
    price: undefined,
    minOrder: 32_000
  },
  bandwidth: undefined,
  addresses: [],
  fees: [
    {
      minutes: 1_440,
      sun: 500,
      minBorrow: 32_000
    }
  ],
  orders: [
    {
      energy: 64_000,
      duration: 86_400,
      payment: 3_000_000,
      buyerAPY: undefined,
      sellerAPY: undefined,
      created: Date.now()
    },
    {
      energy: 32_000,
      duration: 86_400,
      payment: 2_000_000,
      buyerAPY: undefined,
      sellerAPY: undefined,
      created: Date.now()
    }
  ],
  affiliate: undefined,
  description: undefined,
  iconHtml: undefined,
  isActive: true,
  stats: {
    successRate: 0.8
  },
  availabilityPercent: undefined,
  effectivePrice: undefined,
  metadata: undefined,
  siteLinks: undefined,
  social: undefined
};

describe('MarketAnalytics', () => {
  it('computes pricing summary with normalized prices', () => {
    const { pricing } = MarketAnalytics.computePricing(baseSnapshot);
    expect(pricing).toBeDefined();
    expect(pricing?.unit).toBe('trx_per_32000_energy_per_day');
    expect(pricing?.effectivePrice).toBeCloseTo(1.5, 4);
    expect(pricing?.bestPrice).toBeCloseTo(1.5, 4);
    expect(pricing?.averagePrice).toBeGreaterThan(0);
    expect(pricing?.sampleSize).toBeGreaterThan(0);
  });

  it('detects bulk discount tiers when larger orders are cheaper', () => {
    const analytics = MarketAnalytics.computePricing(baseSnapshot);
    const bulkDiscount = MarketAnalytics.detectBulkDiscount(analytics.pricePoints);
    expect(bulkDiscount).toBeDefined();
    expect(bulkDiscount?.hasDiscount).toBe(true);
    expect(bulkDiscount?.tiers?.length).toBeGreaterThan(0);
  });

  it('calculates availability confidence with reliability weighting', () => {
    const analytics = MarketAnalytics.computePricing(baseSnapshot);
    const confidence = MarketAnalytics.computeAvailabilityConfidence({
      snapshot: baseSnapshot,
      pricing: analytics.pricing,
      reliability: 0.9
    });
    expect(confidence).toBeGreaterThan(0.4);
    expect(confidence).toBeLessThanOrEqual(1);
  });
});
