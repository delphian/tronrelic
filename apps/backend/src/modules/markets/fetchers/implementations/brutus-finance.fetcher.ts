import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketFetcherContext } from '../types.js';
import type { MarketSnapshot } from '../../dtos/market-snapshot.dto.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../../../config/market-providers.js';

const MARKET_GUID = 'brutus-finance';

interface AvailabilityEntry {
  available: string | number;
}

interface AvailabilityResponse {
  av_energy: AvailabilityEntry[];
  av_band: AvailabilityEntry[];
  total_energy_pool: string | number;
  total_bandwidth_pool: string | number;
}

/**
 * Pricing structure returned from Brutus Finance /main/prices/all endpoint.
 * All prices are quoted in TRX per 100K energy units or per 1000 bandwidth units.
 */
interface PricingResponse {
  energy_minutes_100K: number;      // TRX per 100K energy for 5-minute rental
  energy_hour_100K: number;         // TRX per 100K energy for 1-hour rental
  energy_one_day_100K: number;      // TRX per 100K energy for 1-day rental
  energy_over_one_day_100K: number; // TRX per 100K energy for 3+ day rental
  band_minutes_1000: number;        // TRX per 1000 bandwidth for 5-minute rental
  band_hour_1000: number;           // TRX per 1000 bandwidth for 1-hour rental
  band_one_day_1000: number;        // TRX per 1000 bandwidth for 1-day rental
  band_over_one_day_1000: number;   // TRX per 1000 bandwidth for 3+ day rental
}

function sumAvailable(entries: AvailabilityEntry[]): number {
  return entries.reduce((sum, entry) => {
    const raw = typeof entry.available === 'string' ? entry.available.replace(/,/g, '') : entry.available;
    const value = Number(raw);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

/**
 * Parses a numeric value from string or number format, handling comma separators.
 *
 * @param raw - The raw value to parse (string with commas, number, or undefined)
 * @returns Parsed number, or 0 if invalid/undefined
 */
function parseNumber(raw: string | number | undefined): number {
  if (typeof raw === 'number') {
    return raw;
  }
  if (typeof raw === 'string') {
    const value = Number(raw.replace(/,/g, ''));
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
}

/**
 * Converts Brutus Finance pricing (TRX per 100K energy) to our standard format (SUN per unit).
 * This normalization allows the pricing matrix calculator to compare Brutus with other markets.
 *
 * @param trxPer100K - Price in TRX for 100,000 energy units
 * @returns Price in SUN per single energy unit
 *
 * @example
 * // Brutus quotes 5.0 TRX per 100K energy
 * convertBrutusPriceToSunPerUnit(5.0)
 * // Returns: 50 SUN per unit (5.0 * 1_000_000 / 100_000)
 */
function convertBrutusPriceToSunPerUnit(trxPer100K: number): number {
  const sunPer100K = trxPer100K * 1_000_000; // Convert TRX to SUN
  return sunPer100K / 100_000; // Normalize to per-unit pricing
}

/**
 * Builds fee schedule from Brutus pricing tiers.
 * Brutus offers different pricing for different rental durations.
 *
 * @param pricing - Raw pricing data from /main/prices/all endpoint
 * @returns Array of fee entries with duration and normalized pricing
 */
function buildFeeSchedule(pricing: PricingResponse): Array<{ minutes: number; sun: number }> {
  return [
    {
      minutes: 5,
      sun: convertBrutusPriceToSunPerUnit(pricing.energy_minutes_100K)
    },
    {
      minutes: 60,
      sun: convertBrutusPriceToSunPerUnit(pricing.energy_hour_100K)
    },
    {
      minutes: 1440, // 1 day
      sun: convertBrutusPriceToSunPerUnit(pricing.energy_one_day_100K)
    },
    {
      minutes: 4320, // 3 days
      sun: convertBrutusPriceToSunPerUnit(pricing.energy_over_one_day_100K)
    },
    {
      minutes: 10080, // 7 days
      sun: convertBrutusPriceToSunPerUnit(pricing.energy_over_one_day_100K)
    },
    {
      minutes: 20160, // 14 days (max Brutus duration)
      sun: convertBrutusPriceToSunPerUnit(pricing.energy_over_one_day_100K)
    }
  ];
}

export class BrutusFinanceFetcher extends BaseMarketFetcher {
  private readonly config = marketProviderConfig.brutusFinance;

  constructor() {
    super({ name: 'Brutus Finance', guid: MARKET_GUID, schedule: '*/10 * * * *' });
  }

  /**
   * Fetches current market data from Brutus Finance API.
   * Combines availability data with comprehensive pricing tiers across multiple rental durations.
   *
   * @param context - Market fetcher context providing HTTP client and logging
   * @returns Market snapshot with availability and pricing data, or null on fatal error
   */
  async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    // Fetch availability and pricing data in parallel for efficiency
    const [availabilityResponse, pricingResponse] = await Promise.all([
      executeWithRetry(
        () =>
          context.http.get<AvailabilityResponse>(this.config.endpoints.availability, {
            timeout: this.timeoutMs
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'availability'
        }
      ),
      executeWithRetry(
        () =>
          context.http.get<PricingResponse>(this.config.endpoints.pricing, {
            timeout: this.timeoutMs
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'pricing'
        }
      )
    ]);

    const availabilityData = availabilityResponse.data ?? ({} as AvailabilityResponse);
    const pricingData = pricingResponse.data;

    const energyAvailable = sumAvailable(availabilityData.av_energy ?? []);
    const bandwidthAvailable = sumAvailable(availabilityData.av_band ?? []);

    // Build comprehensive fee schedule from pricing tiers
    const fees = pricingData ? buildFeeSchedule(pricingData) : undefined;

    const snapshot: MarketSnapshot = {
      guid: this.guid,
      name: this.name,
      priority: 100,
      energy: {
        total: parseNumber(availabilityData.total_energy_pool),
        available: energyAvailable
      },
      bandwidth: {
        total: parseNumber(availabilityData.total_bandwidth_pool),
        available: bandwidthAvailable
      },
      addresses: this.config.addresses ?? [],
      siteLinks: this.config.siteLinks,
      fees,
      description:
        'In Brutus Energy Bot, we have built a DApp for a faster and secure resource rental experience on the Tron network. We simplify the process and deliver efficient management at competitive prices.',
      iconHtml: '<img class="img-fluid" src="/images/site-icons/brutusfinance.png" alt="Brutus Finance Energy Market" />',
      isActive: true,
      metadata: {
        source: 'brutus-finance',
        availabilityEndpoint: this.config.endpoints.availability,
        pricingEndpoint: this.config.endpoints.pricing,
        pricingTiers: pricingData
          ? {
              fiveMinutes: pricingData.energy_minutes_100K,
              oneHour: pricingData.energy_hour_100K,
              oneDay: pricingData.energy_one_day_100K,
              multiDay: pricingData.energy_over_one_day_100K
            }
          : undefined
      }
    };

    return snapshot;
  }
}
