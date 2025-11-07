import type { IPluginContext } from '@tronrelic/types';
import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketSnapshot } from '../../../shared/types/market-snapshot.dto.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../config/market-providers.js';

const MARKET_GUID = 'ergon';

interface ErgonInfoResponse {
  [key: string]: number;
}

interface ErgonPricingResponse {
  status: string;
  error: string;
  basePrice: number;
}

export class ErgonFetcher extends BaseMarketFetcher {
  private readonly config = marketProviderConfig.ergon;

  constructor(context: IPluginContext) {
    super(context, { name: 'Ergon', guid: MARKET_GUID });
  }

  async pull(): Promise<MarketSnapshot | null> {
    const [infoResponse, pricingResponse] = await Promise.all([
      executeWithRetry(
        () =>
          this.context.http.get<ErgonInfoResponse>(this.config.endpoints.info, {
            timeout: this.timeoutMs
          }),
        {
          logger: this.context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'info'
        }
      ),
      executeWithRetry(
        () =>
          this.context.http.get<ErgonPricingResponse>(this.config.endpoints.pricing, {
            timeout: this.timeoutMs
          }),
        {
          logger: this.context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'pricing'
        }
      )
    ]);

    const info = infoResponse.data ?? {};
    const pricing = pricingResponse.data;

    const availableEnergy = Number(info['Available energy']) || 0;
    const utilization = Number(info.Utilization) || 0;
    const totalEnergy = utilization >= 100 ? availableEnergy : availableEnergy / ((100 - utilization) * 0.01 || 1);

    // Convert basePrice from the API format to TRX per million energy per day
    // basePrice: 38404953 SUN represents 38.4 TRX per million energy per day
    const basePricePerMPerDay = pricing?.basePrice ? pricing.basePrice / 1_000_000 : 0;

    // Calculate pricing tiers based on duration
    // According to Ergon's UI: 1 day base price, 2 days ~15% discount, 3+ days ~30% discount
    const oneDayPricePerM = basePricePerMPerDay;
    const twoDayPricePerM = basePricePerMPerDay * 0.85; // 15% discount
    const threePlusDayPricePerM = basePricePerMPerDay * 0.7; // 30% discount

    // Convert from TRX per million to SUN per unit for the fees array
    // The pricing system expects fee.sun to be price per single energy unit
    // Formula: (TRX per million energy) / 1,000,000 = TRX per unit → * 1,000,000 = SUN per unit
    const oneDayPricePerUnit = oneDayPricePerM; // Already in TRX/M, which equals SUN per unit
    const twoDayPricePerUnit = twoDayPricePerM;
    const threePlusDayPricePerUnit = threePlusDayPricePerM;

    const snapshot: MarketSnapshot = {
      guid: this.guid,
      name: this.name,
      priority: 100,
      energy: {
        total: Math.max(0, Math.floor(totalEnergy)),
        available: Math.max(0, Math.floor(availableEnergy)),
        price: oneDayPricePerM,
        unit: 'TRX/M/day'
      },
      fees: [
        {
          minutes: 1440, // 1 day
          sun: oneDayPricePerUnit, // SUN per unit (38.4 SUN per energy unit)
          description: 'Base price for 1 day rental',
          type: 'rental'
        },
        {
          minutes: 2880, // 2 days
          sun: twoDayPricePerUnit, // SUN per unit (~32.6 SUN per energy unit)
          description: 'Discounted price for 2 day rental (~15% discount)',
          type: 'rental'
        },
        {
          minutes: 4320, // 3 days
          sun: threePlusDayPricePerUnit, // SUN per unit (~26.9 SUN per energy unit)
          description: 'Discounted price for 3+ day rental (~30% discount). Up to 10% additional discount for USTX staking',
          type: 'rental'
        }
      ],
      siteLinks: this.config.siteLinks,
      social: this.config.social,
      addresses: this.config.addresses ?? [],
      contract: 'THbysanZ8nbpPabgWXm5HkQpt151RjhvTj',
      description:
        'Egon is a dApp made to simplify user access to Tron Stake 2.0. Save on transaction fees by renting energy. Earn by staking TRX. Participate by supporting a community driven Super Representative.',
      iconHtml: '<img class="img-fluid" src="/images/site-icons/ergon-half.png" alt="Ergon Tron Energy Market" />',
      isActive: true,
      metadata: {
        source: 'ergon',
        infoEndpoint: this.config.endpoints.info,
        pricingEndpoint: this.config.endpoints.pricing,
        basePriceRaw: pricing?.basePrice,
        utilizationRate: utilization,
        ustxStakingDiscount: 'up to 10%'
      }
    };

    return snapshot;
  }
}
