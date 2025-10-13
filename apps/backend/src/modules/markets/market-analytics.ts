import type {
  MarketBulkDiscount,
  MarketBulkDiscountTier,
  MarketPricePoint,
  MarketPricingSummary
} from '@tronrelic/shared';
import type { MarketSnapshot } from './dtos/market-snapshot.dto.js';

const ENERGY_BASE_UNIT = 32_000;
const SECONDS_PER_DAY = 86_400;

export interface PricingComputationResult {
  pricing?: MarketPricingSummary;
  pricePoints: MarketPricePoint[];
}

function round(value: number, precision = 4) {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export class MarketAnalytics {
  static computePricing(snapshot: MarketSnapshot): PricingComputationResult {
    const timestamp = new Date().toISOString();
    const pricePoints: MarketPricePoint[] = [];

    for (const order of snapshot.orders ?? []) {
      const energy = order.energy ?? 0;
      const paymentSun = order.payment ?? 0;
      const durationSeconds = order.duration ?? 0;

      if (!isFinitePositive(energy) || !isFinitePositive(paymentSun) || !isFinitePositive(durationSeconds)) {
        continue;
      }

      const paymentTrx = paymentSun / 1_000_000;
      const energyScale = ENERGY_BASE_UNIT / energy;
      const timeScale = SECONDS_PER_DAY / durationSeconds;
      const normalizedPrice = paymentTrx * energyScale * timeScale;

      if (!isFinitePositive(normalizedPrice)) {
        continue;
      }

      pricePoints.push({
        source: 'order',
        durationMinutes: round(durationSeconds / 60, 2),
        energyAmount: energy,
        price: round(normalizedPrice),
        rawPrice: round(paymentTrx, 6),
        includesFees: true,
        timestamp,
        notes: 'Derived from live order book'
      });
    }

    for (const fee of snapshot.fees ?? []) {
      if (!isFinitePositive(fee.sun)) {
        continue;
      }

      const durationMinutes = isFinitePositive(fee.minutes) ? fee.minutes! : 1_440;
      const durationSeconds = durationMinutes * 60;
      const pricePerEnergy = fee.sun! / 1_000_000;
      const timeScale = SECONDS_PER_DAY / durationSeconds;
      const normalizedPrice = pricePerEnergy * ENERGY_BASE_UNIT * timeScale;

      if (!isFinitePositive(normalizedPrice)) {
        continue;
      }

      pricePoints.push({
        source: 'fee',
        durationMinutes,
        energyAmount: isFinitePositive(fee.minBorrow)
          ? fee.minBorrow!
          : snapshot.energy.minOrder && isFinitePositive(snapshot.energy.minOrder)
          ? snapshot.energy.minOrder!
          : ENERGY_BASE_UNIT,
        price: round(normalizedPrice),
        rawPrice: round(pricePerEnergy * ENERGY_BASE_UNIT, 6),
        includesFees: true,
        timestamp,
        notes: 'Derived from provider fee schedule'
      });
    }

    if (isFinitePositive(snapshot.energy.price)) {
      const minOrder = snapshot.energy.minOrder && isFinitePositive(snapshot.energy.minOrder)
        ? snapshot.energy.minOrder!
        : ENERGY_BASE_UNIT;
      const normalizedPrice = snapshot.energy.price! * (ENERGY_BASE_UNIT / minOrder);

      if (isFinitePositive(normalizedPrice)) {
        pricePoints.push({
          source: 'manual',
          durationMinutes: 1_440,
          energyAmount: minOrder,
          price: round(normalizedPrice),
          rawPrice: round(snapshot.energy.price!, 6),
          includesFees: false,
          timestamp,
          notes: 'Derived from advertised spot price'
        });
      }
    }

    const validPoints = pricePoints.filter(point => isFinitePositive(point.price));

    if (!validPoints.length) {
      return { pricePoints: [] };
    }

    const sorted = [...validPoints].sort((a, b) => a.price - b.price);
    const bestPrice = sorted[0].price;
    const worstPrice = sorted[sorted.length - 1].price;
    const sampleSize = sorted.length;
    const averagePrice = sorted.reduce((sum, point) => sum + point.price, 0) / sampleSize;
    const medianPrice = sampleSize % 2 === 1
      ? sorted[Math.floor(sampleSize / 2)].price
      : (sorted[sampleSize / 2 - 1].price + sorted[sampleSize / 2].price) / 2;

    const pricing: MarketPricingSummary = {
      unit: 'trx_per_32000_energy_per_day',
      effectivePrice: round(bestPrice),
      bestPrice: round(bestPrice),
      medianPrice: round(medianPrice),
      averagePrice: round(averagePrice),
      worstPrice: round(worstPrice),
      sampleSize,
      collectedAt: timestamp,
      sources: validPoints.map(point => ({
        ...point,
        price: round(point.price),
        timestamp: point.timestamp
      }))
    };

    return { pricing, pricePoints: validPoints };
  }

  static computeAvailabilityConfidence(params: {
    snapshot: MarketSnapshot;
    pricing?: MarketPricingSummary;
    reliability?: number;
  }): number {
    const { snapshot, pricing, reliability } = params;

    const availabilityRatio = snapshot.energy.total > 0
      ? Math.max(0, Math.min(snapshot.energy.available / snapshot.energy.total, 1))
      : 0;

    const reliabilityScore = typeof reliability === 'number' && Number.isFinite(reliability)
      ? Math.max(0, Math.min(reliability, 1))
      : 0;

    const pricingScore = pricing
      ? Math.min(pricing.sampleSize / 5, 1)
      : 0;

    const successScore = snapshot.stats?.successRate && Number.isFinite(snapshot.stats.successRate)
      ? Math.max(0, Math.min(snapshot.stats.successRate, 1))
      : 0;

    let score = reliabilityScore * 0.5 + availabilityRatio * 0.3 + pricingScore * 0.1 + successScore * 0.1;

    if (!pricing?.sampleSize) {
      score = Math.max(0, score - 0.05);
    }

    return round(Math.max(0, Math.min(score, 1)), 3);
  }

  static detectBulkDiscount(pricePoints: MarketPricePoint[]): MarketBulkDiscount | undefined {
    const tierMap = new Map<number, number>();

    for (const point of pricePoints) {
      if (!isFinitePositive(point.energyAmount) || !isFinitePositive(point.price)) {
        continue;
      }

      const existing = tierMap.get(point.energyAmount!);
      if (existing === undefined || point.price < existing) {
        tierMap.set(point.energyAmount!, point.price);
      }
    }

    if (tierMap.size < 2) {
      return undefined;
    }

    const tiers = Array.from(tierMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([minEnergy, price]) => ({ minEnergy, price }));

    const basePrice = tiers[0].price;
    const discountTiers: MarketBulkDiscountTier[] = [];
    let maxDiscount = 0;

    for (let i = 1; i < tiers.length; i += 1) {
      const tier = tiers[i];
      if (!isFinitePositive(basePrice)) {
        continue;
      }
      const discount = ((basePrice - tier.price) / basePrice) * 100;
      if (discount > 1) {
        const roundedDiscount = round(discount, 2);
        discountTiers.push({
          minEnergy: tier.minEnergy,
          price: round(tier.price),
          discountPercent: roundedDiscount
        });
        if (roundedDiscount > maxDiscount) {
          maxDiscount = roundedDiscount;
        }
      }
    }

    if (!discountTiers.length) {
      return {
        hasDiscount: false,
        summary: undefined,
        tiers: undefined
      };
    }

    const summary = `Save up to ${round(maxDiscount, 2)}% when renting ≥ ${discountTiers[0].minEnergy.toLocaleString()} energy.`;

    return {
      hasDiscount: true,
      summary,
      tiers: discountTiers
    } satisfies MarketBulkDiscount;
  }
}
