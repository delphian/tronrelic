import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketFetcherContext } from '../types.js';
import type { MarketSnapshot } from '../../dtos/market-snapshot.dto.js';
import { computeOrderApy } from '../helpers/market-apy.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../../../config/market-providers.js';

interface FeeeEnergyResponse {
  data: {
    total_energy: number;
    usable_energy: number;
  };
}

interface FeeeConfigResponse {
  data: {
    price_c2c: {
      energy: {
        default_sun_1h: number;
        default_sun_1d: number;
        default_sun: number;
      };
    };
  };
}

interface FeeeTradesResponse {
  data: Array<{
    resource_type: number;
    create_time: number;
    max_amount: number;
    rent_time_second: number;
    max_payout: number;
  }>;
  pagination: {
    has_more: boolean;
    page: number;
  };
}

const MARKET_GUID = 'feee-io';

export class FeeeIoFetcher extends BaseMarketFetcher {
  private readonly config = marketProviderConfig.feeeIo;

  constructor() {
    super({ name: 'Feee.io', guid: MARKET_GUID, schedule: '*/10 * * * *' });
  }

  private async fetchTrades(context: MarketFetcherContext) {
    const trades: FeeeTradesResponse['data'] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await executeWithRetry(
        () =>
          context.http.get<FeeeTradesResponse>(this.config.endpoints.trades, {
            timeout: this.timeoutMs,
            params: {
              page,
              page_size: 100,
              sort: 1,
              resource_type: 1
            }
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: `trades-page-${page}`
        }
      );

      trades.push(...(response.data.data ?? []));
      hasMore = response.data.pagination?.has_more ?? false;
      page = (response.data.pagination?.page ?? page) + 1;
    }

    return trades;
  }

  async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    const [energyResponse, configResponse, trades] = await Promise.all([
      executeWithRetry(
        () =>
          context.http.get<FeeeEnergyResponse>(this.config.endpoints.energy, {
            timeout: this.timeoutMs
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'energy'
        }
      ),
      executeWithRetry(
        () =>
          context.http.get<FeeeConfigResponse>(this.config.endpoints.config, {
            timeout: this.timeoutMs
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'config'
        }
      ),
      this.fetchTrades(context)
    ]);

    const energyData = energyResponse.data.data;
    const priceConfig = configResponse.data.data.price_c2c.energy;

    const fees = [
      {
        minutes: 60,
        sun: priceConfig.default_sun_1h,
        apy: context.chainParameters?.getAPY
          ? context.chainParameters.getAPY(100_000, priceConfig.default_sun_1h, 1 / 24)
          : undefined
      },
      {
        minutes: 60 * 24,
        sun: priceConfig.default_sun_1d,
        apy: context.chainParameters?.getAPY
          ? context.chainParameters.getAPY(100_000, priceConfig.default_sun_1d, 1)
          : undefined
      },
      {
        minutes: 60 * 24 * 3,
        sun: priceConfig.default_sun,
        apy: context.chainParameters?.getAPY
          ? context.chainParameters.getAPY(100_000, priceConfig.default_sun, 3)
          : undefined
      }
    ];

    let orderMaxBuyerAPY: number | undefined;
    let orderMaxSellerAPY: number | undefined;

    const orderSnapshots = trades
      .filter(order => order.resource_type === 1)
      .map(order => {
        const paymentSun = order.max_payout * 1_000_000;
        const buyerAPY = computeOrderApy({
          trEnergy: context.chainParameters,
          energy: order.max_amount,
          paymentSun,
          durationSeconds: order.rent_time_second,
          deductFee: false
        });
        const sellerAPY = computeOrderApy({
          trEnergy: context.chainParameters,
          energy: order.max_amount,
          paymentSun,
          durationSeconds: order.rent_time_second,
          deductFee: true
        });

        if (buyerAPY !== undefined) {
          orderMaxBuyerAPY = orderMaxBuyerAPY === undefined ? buyerAPY : Math.max(orderMaxBuyerAPY, buyerAPY);
        }
        if (sellerAPY !== undefined) {
          orderMaxSellerAPY = orderMaxSellerAPY === undefined ? sellerAPY : Math.max(orderMaxSellerAPY, sellerAPY);
        }

        return {
          energy: order.max_amount,
          created: order.create_time,
          duration: order.rent_time_second,
          payment: paymentSun,
          buyerAPY,
          sellerAPY
        };
      });

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
      priority: 2,
      energy: {
        total: energyData?.total_energy ?? 0,
        available: energyData?.usable_energy ?? 0,
        price: undefined,
        minOrder: this.config.minOrder ?? 32_000
      },
      addresses: this.config.addresses ?? [],
      social: this.config.social,
      siteLinks: this.config.siteLinks,
      affiliate,
      fees,
      orders: orderSnapshots,
      description:
        'Feee.io is an energy trading platform in the TRON ecosystem, providing lower energy costs and efficient rental services.',
      iconHtml: '<div class="tr-feee-icon"></div>',
      stats: {
        orderMaxBuyerAPY,
        orderMaxSellerAPY
      },
      isActive: true,
      metadata: {
        source: 'feee-io',
        energyEndpoint: this.config.endpoints.energy,
        configEndpoint: this.config.endpoints.config,
        tradesEndpoint: this.config.endpoints.trades,
        affiliateLink: this.config.affiliateLink
      }
    };

    return snapshot;
  }
}
