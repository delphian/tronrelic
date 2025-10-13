import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketFetcherContext } from '../types.js';
import type { MarketSnapshot } from '../../dtos/market-snapshot.dto.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../../../config/market-providers.js';

/**
 * Response structure from itrx.io API endpoint `/api/v1/frontend/index-data`
 *
 * This endpoint provides comprehensive market data including energy availability,
 * pricing tiers for different rental durations, order limits, and platform statistics.
 */
interface TronEnergySummaryResponse {
    /** Total energy capacity available on the platform */
    platform_total_energy: number;
    /** Currently available energy for rental */
    platform_avail_energy: number;
    /** Total energy collected across all transactions */
    platform_collect_energy?: number;
    /** Maximum energy available in a single order */
    platform_max_energy?: number;

    /** Tiered pricing data for different rental periods */
    tiered_pricing?: Array<{
        /** Period identifier: 0 (immediate), 1 (1 hour), 3 (3 days), 30 (30 days) */
        period: number;
        /** Price in SUN per energy unit for this period */
        price: number;
    }>;

    /** Default pricing fallback (SUN) */
    default_price?: number;

    /** Order limits and thresholds */
    minimum_order_energy?: number;
    maximum_order_energy?: number;

    /** Small amount pricing threshold and adjustment */
    small_amount?: number;
    small_addition?: number;

    /** Large amount pricing threshold and discount */
    big_amount?: number;
    big_discount?: number;

    /** USDT transaction energy requirements */
    usdt_energy_need_old?: number;
    usdt_energy_need_new?: number;

    /** Platform collection addresses */
    collection_address?: string;
    collection_hour_address?: string;
    collection_one_day_address?: string;
    collection_three_days_address?: string;
    collection_thirty_days_address?: string;
}

const MARKET_GUID = 'tron-energy';

export class TronEnergyFetcher extends BaseMarketFetcher {
  private readonly config = marketProviderConfig.tronEnergy;

  constructor() {
    super({ name: 'Tron Energy', guid: MARKET_GUID, schedule: '*/10 * * * *' });
  }

  /**
   * Pulls market data from itrx.io API
   *
   * Fetches comprehensive pricing information including multiple rental durations
   * (0-period/immediate, 1-hour, 3-day, 30-day), energy availability, order limits,
   * and platform statistics. Transforms the pricing data into normalized fee structures
   * that account for TRON's energy regeneration mechanism.
   *
   * @param context - Market fetcher context with HTTP client and logger
   * @returns Market snapshot with pricing tiers or null on fatal error
   */
  async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    const response = await executeWithRetry(
      () =>
        context.http.get<TronEnergySummaryResponse>(this.config.endpoints.summary, {
          timeout: this.timeoutMs
        }),
      {
        logger: context.logger,
        fetcher: this.name,
        marketGuid: this.guid,
        requestLabel: 'summary'
      }
    );

    const summary = response.data;

    // Transform pricing data into fee structure
    // itrx.io uses period keys: 0 (immediate), 1 (1 hour), 3 (3 days), 30 (30 days)
    const fees = [];

    if (summary.tiered_pricing && Array.isArray(summary.tiered_pricing)) {
        for (const tier of summary.tiered_pricing) {
            // Map period to duration in minutes
            let minutes: number;

            switch (tier.period) {
                case 0:
                    minutes = 60; // Immediate treated as 1 hour
                    break;
                case 1:
                    minutes = 60; // 1 hour
                    break;
                case 3:
                    minutes = 60 * 24 * 3; // 3 days
                    break;
                case 30:
                    minutes = 60 * 24 * 30; // 30 days
                    break;
                default:
                    // Unknown period, try to infer duration
                    minutes = tier.period * 60 * 24; // Assume period is in days
            }

            fees.push({
                minutes,
                sun: tier.price
            });
        }
    }

    // Merge config addresses with API-provided collection addresses
    const addresses = [...(this.config.addresses ?? [])];

    // Add collection addresses from the API response
    const collectionAddresses = [
        summary.collection_address ? { address: summary.collection_address, labels: ['billing', 'collection'] } : null,
        summary.collection_hour_address ? { address: summary.collection_hour_address, labels: ['collection', '1-hour'] } : null,
        summary.collection_one_day_address ? { address: summary.collection_one_day_address, labels: ['collection', '1-day'] } : null,
        summary.collection_three_days_address ? { address: summary.collection_three_days_address, labels: ['collection', '3-day'] } : null,
        summary.collection_thirty_days_address ? { address: summary.collection_thirty_days_address, labels: ['collection', '30-day'] } : null
    ].filter((item): item is { address: string; labels: string[] } => item !== null);

    for (const item of collectionAddresses) {
        if (!addresses.find(a => a.address === item.address)) {
            addresses.push(item);
        }
    }

    const affiliate = this.config.affiliateLink
      ? {
          link: this.config.affiliateLink,
          commission: undefined,
          cookieDuration: undefined
        }
      : undefined;

    const snapshot: MarketSnapshot = {
      guid: this.guid,
      name: this.name,
      priority: 100,
      energy: {
        total: summary.platform_total_energy ?? 0,
        available: summary.platform_avail_energy ?? 0,
        price: summary.default_price,
        minOrder: summary.minimum_order_energy ?? this.config.minOrder ?? 32_000,
        maxOrder: summary.maximum_order_energy
      },
      addresses,
      social: this.config.social,
      siteLinks: this.config.siteLinks,
      fees: fees.length > 0 ? fees : undefined,
      affiliate,
      description:
        'Purchase TRON energy to avoid FAILED-OUT_OF_ENERGY errors. Supports intelligent account custody based on transfer history.',
      iconHtml: `<img class="img-fluid" src="/images/site-icons/tronenergy.png" alt="Tron Energy Rental Market" />`,
      isActive: true,
      metadata: {
        source: 'tron-energy',
        summaryEndpoint: this.config.endpoints.summary,
        affiliateLink: this.config.affiliateLink,
        platformCollectEnergy: summary.platform_collect_energy,
        platformMaxEnergy: summary.platform_max_energy,
        usdtEnergyRequirements: {
            standard: summary.usdt_energy_need_old,
            firstTime: summary.usdt_energy_need_new
        },
        pricingAdjustments: {
            smallAmountLimit: summary.small_amount,
            smallAmountAdd: summary.small_addition,
            bigAmountLimit: summary.big_amount,
            bigAmountDiscount: summary.big_discount
        }
      }
    };

    return snapshot;
  }
}
