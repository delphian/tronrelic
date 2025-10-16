import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketFetcherContext } from '../types.js';
import type { MarketSnapshot } from '../../dtos/market-snapshot.dto.js';
import { computeOrderApy } from '../helpers/market-apy.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../../../config/market-providers.js';

interface TronEnergyInfoResponse {
  market: {
    totalEnergy: number;
    availableEnergy: number;
  };
  price: {
    openEnergy: Array<{
      minDuration: number;
      basePrice: number;
    }>;
  };
}

interface TronEnergyOrderResponse {
  list: Array<{
    status: string;
    resource: number;
    amount: number;
    created_at: string;
    duration: number;
    payment: number;
  }>;
}

const MARKET_GUID = 'tron-energy-market';
const SUPPORTED_DURATIONS_MIN = new Set([60, 60 * 24, 60 * 24 * 3]);
const MARKET_FEE = 0.2;

export class TronEnergyMarketFetcher extends BaseMarketFetcher {
  private readonly config = marketProviderConfig.tronEnergyMarket;

  constructor() {
    super({ name: 'Tron Energy Market', guid: MARKET_GUID });
  }

  async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    const [infoResponse, ordersResponse] = await Promise.all([
      executeWithRetry(
        () =>
          context.http.get<TronEnergyInfoResponse>(this.config.endpoints.info, {
            timeout: this.timeoutMs
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'info'
        }
      ),
      executeWithRetry(
        () =>
          context.http.get<TronEnergyOrderResponse>(this.config.endpoints.orders, {
            timeout: this.timeoutMs
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'orders'
        }
      )
    ]);

    const info = infoResponse.data;
    const orders = ordersResponse.data.list ?? [];

    const fees = (info.price?.openEnergy ?? [])
      .map(entry => {
        const minutes = Math.floor(entry.minDuration / 60);
        if (!SUPPORTED_DURATIONS_MIN.has(minutes)) {
          return null;
        }

        const apy = context.chainParameters?.getAPY
          ? context.chainParameters.getAPY(100_000, entry.basePrice, entry.minDuration / (24 * 60))
          : undefined;

        return {
          minutes,
          sun: entry.basePrice,
          apy: typeof apy === 'number' && Number.isFinite(apy) ? apy : undefined
        };
      })
      .filter((fee): fee is NonNullable<typeof fee> => Boolean(fee));

    let orderMaxBuyerAPY: number | undefined;
    let orderMaxSellerAPY: number | undefined;

    const orderSnapshots = orders
      .filter(order => order.status === 'Pending' && order.resource === 0)
      .map(order => {
        const created = Date.parse(order.created_at);
        const buyerAPY = computeOrderApy({
          trEnergy: context.chainParameters,
          energy: order.amount,
          paymentSun: order.payment,
          durationSeconds: order.duration,
          marketFee: MARKET_FEE,
          deductFee: false
        });
        const sellerAPY = computeOrderApy({
          trEnergy: context.chainParameters,
          energy: order.amount,
          paymentSun: order.payment,
          durationSeconds: order.duration,
          marketFee: MARKET_FEE,
          deductFee: true
        });

        if (buyerAPY !== undefined) {
          orderMaxBuyerAPY = orderMaxBuyerAPY === undefined ? buyerAPY : Math.max(orderMaxBuyerAPY, buyerAPY);
        }
        if (sellerAPY !== undefined) {
          orderMaxSellerAPY = orderMaxSellerAPY === undefined ? sellerAPY : Math.max(orderMaxSellerAPY, sellerAPY);
        }

        return {
          energy: order.amount,
          created: Number.isNaN(created) ? undefined : created,
          duration: order.duration,
          payment: order.payment,
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
      priority: 3,
      energy: {
        total: info.market?.totalEnergy ?? 0,
        available: info.market?.availableEnergy ?? 0,
        price: undefined,
        minOrder: this.config.minOrder ?? 32_000
      },
      addresses: this.config.addresses ?? [],
      social: this.config.social,
      siteLinks: this.config.siteLinks,
      fees,
      orders: orderSnapshots,
      affiliate,
      description:
        'Energy is easy to purchase on TEM. In just a few clicks you will be able to set up your wallet on the platform and access the pools we provide. Explore TEM, the real alternative to TRON mining.',
      iconHtml: '<img class="img-fluid" src="/images/site-icons/tronenergymarket.svg" alt="Tron Energy Market" />',
      stats: {
        orderMaxBuyerAPY,
        orderMaxSellerAPY
      },
      isActive: true,
      metadata: {
        source: 'tron-energy-market',
        infoEndpoint: this.config.endpoints.info,
        ordersEndpoint: this.config.endpoints.orders,
        affiliateLink: this.config.affiliateLink
      }
    };

    return snapshot;
  }
}
