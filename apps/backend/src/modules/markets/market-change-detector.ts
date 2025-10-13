import type { MarketDocument } from '@tronrelic/shared';

const PRICE_CHANGE_THRESHOLD = 0.005; // 0.5%
const AVAILABILITY_CHANGE_THRESHOLD = 5; // percentage points
const RELIABILITY_THRESHOLD = 0.05; // absolute delta

export interface MarketChangeResult {
  hasChanged: boolean;
  diff: Record<string, { previous: unknown; current: unknown }>;
}

export class MarketChangeDetector {
  static evaluate(previous: MarketDocument | null | undefined, current: MarketDocument): MarketChangeResult {
    if (!previous) {
      return { hasChanged: true, diff: {} };
    }

    const diff: Record<string, { previous: unknown; current: unknown }> = {};
    let hasChanged = false;

    if (MarketChangeDetector.priceChanged(previous, current)) {
      hasChanged = true;
      diff.effectivePrice = { previous: previous.effectivePrice, current: current.effectivePrice };
    }

    if (MarketChangeDetector.availabilityChanged(previous, current)) {
      hasChanged = true;
      diff.availabilityPercent = { previous: previous.availabilityPercent, current: current.availabilityPercent };
    }

    if (previous.isActive !== current.isActive) {
      hasChanged = true;
      diff.isActive = { previous: previous.isActive, current: current.isActive };
    }

    if (MarketChangeDetector.reliabilityChanged(previous, current)) {
      hasChanged = true;
      diff.reliability = { previous: previous.reliability, current: current.reliability };
    }

    if (!hasChanged && JSON.stringify(previous.stats) !== JSON.stringify(current.stats)) {
      hasChanged = true;
      diff.stats = { previous: previous.stats, current: current.stats };
    }

    return { hasChanged, diff };
  }

  private static priceChanged(previous: MarketDocument, current: MarketDocument): boolean {
    if (!previous.effectivePrice || !current.effectivePrice) {
      return false;
    }
    const delta = Math.abs(current.effectivePrice - previous.effectivePrice);
    const ratio = delta / previous.effectivePrice;
    return ratio >= PRICE_CHANGE_THRESHOLD;
  }

  private static availabilityChanged(previous: MarketDocument, current: MarketDocument): boolean {
    if (previous.availabilityPercent === undefined || current.availabilityPercent === undefined) {
      return false;
    }
    const delta = Math.abs(current.availabilityPercent - previous.availabilityPercent);
    return delta >= AVAILABILITY_CHANGE_THRESHOLD;
  }

  private static reliabilityChanged(previous: MarketDocument, current: MarketDocument): boolean {
    if (previous.reliability === undefined || current.reliability === undefined) {
      return false;
    }
    const delta = Math.abs(current.reliability - previous.reliability);
    return delta >= RELIABILITY_THRESHOLD;
  }
}
