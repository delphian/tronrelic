import type { IPluginContext } from '@tronrelic/types';
import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketSnapshot } from '../../../shared/types/market-snapshot.dto.js';
import { computeOrderApy } from '../helpers/market-apy.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../config/market-providers.js';

const MARKET_GUID = 'tron-energize';

interface TronEnergizeMarketsResponse {
  infoenergy: {
    a: string;
    r: string;
    dEnergy?: Record<string, Record<string, number>>; // duration -> price -> available_energy
  };
  data: Array<{
    active: boolean;
    duration: string;
    energy: number;
    payout: number;
  }>;
}

function parseNumber(raw: string | number | undefined): number {
  if (typeof raw === 'number') {
    return raw;
  }
  if (typeof raw === 'string') {
    const value = Number(raw.replace(/\s+/g, ''));
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
}

export class TronEnergizeFetcher extends BaseMarketFetcher {
  private readonly config = marketProviderConfig.tronEnergize;

  constructor(context: IPluginContext) {
    super(context, { name: 'Tron Energize', guid: MARKET_GUID });
  }

  async pull(): Promise<MarketSnapshot | null> {
    const response = await executeWithRetry(
      () =>
        this.context.http.get<TronEnergizeMarketsResponse>(this.config.endpoints.markets, {
          timeout: this.timeoutMs
        }),
      {
        logger: this.context.logger,
        fetcher: this.name,
        marketGuid: this.guid,
        requestLabel: 'markets'
      }
    );

    const data = response.data ?? { infoenergy: { a: '0', r: '0' }, data: [] };
    const availableRaw = parseNumber(data.infoenergy?.a);
    const rentedRaw = parseNumber(data.infoenergy?.r);
    const available = availableRaw;
    const total = availableRaw + rentedRaw;

    // Extract fee schedule from dEnergy structure
    // dEnergy format: { "duration_seconds": { "sun_per_energy": available_energy, ... }, ... }
    const fees: Array<{ minutes: number; sun: number }> = [];
    if (data.infoenergy?.dEnergy) {
      for (const [durationStr, priceMap] of Object.entries(data.infoenergy.dEnergy)) {
        const durationSeconds = Number(durationStr);
        if (!durationSeconds || !priceMap) continue;

        // Get the lowest price for this duration (best deal for buyers)
        const prices = Object.keys(priceMap).map(Number).filter(n => !isNaN(n));
        if (prices.length === 0) continue;

        const lowestPrice = Math.min(...prices);

        fees.push({
          minutes: Math.round(durationSeconds / 60),
          sun: lowestPrice // SUN per energy unit (no energyAmount needed)
        });
      }
    }

    let orderMaxBuyerAPY: number | undefined;
    let orderMaxSellerAPY: number | undefined;

    const orderSnapshots = (data.data ?? [])
      .filter(order => order.active)
      .map(order => {
        const durationSeconds = (Number(order.duration) || 0) * 3;
        const paymentSun = Number(order.payout) || 0;

        const buyerAPY = computeOrderApy({
          trEnergy: this.context.chainParameters,
          energy: order.energy,
          paymentSun,
          durationSeconds,
          marketFee: 0.25,
          deductFee: false
        });
        const sellerAPY = computeOrderApy({
          trEnergy: this.context.chainParameters,
          energy: order.energy,
          paymentSun,
          durationSeconds,
          marketFee: 0.25,
          deductFee: true
        });

        if (buyerAPY !== undefined) {
          orderMaxBuyerAPY = orderMaxBuyerAPY === undefined ? buyerAPY : Math.max(orderMaxBuyerAPY, buyerAPY);
        }
        if (sellerAPY !== undefined) {
          orderMaxSellerAPY = orderMaxSellerAPY === undefined ? sellerAPY : Math.max(orderMaxSellerAPY, sellerAPY);
        }

        return {
          energy: order.energy,
          created: undefined,
          duration: durationSeconds,
          payment: paymentSun,
          buyerAPY,
          sellerAPY
        };
      });

    const snapshot: MarketSnapshot = {
      guid: this.guid,
      name: this.name,
      priority: 5,
      energy: {
        total,
        available
      },
      addresses: this.config.addresses ?? [],
      siteLinks: this.config.siteLinks,
      social: this.config.social,
      fees: fees.length > 0 ? fees : undefined,
      orders: orderSnapshots,
      description:
        'Discover a revolution in energy management with TronEnergize. Rent and rent out energy resources seamlessly with an efficient and transparent platform.',
      iconHtml: '<img class="img-fluid" src="/images/site-icons/tronenergize.png" alt="Tron Energize Energy Market" />',
      stats: {
        orderMaxBuyerAPY,
        orderMaxSellerAPY
      },
      isActive: true,
      metadata: {
        source: 'tron-energize',
        marketsEndpoint: this.config.endpoints.markets
      }
    };

    return snapshot;
  }
}
