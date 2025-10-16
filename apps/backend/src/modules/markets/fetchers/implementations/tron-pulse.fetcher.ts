import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketFetcherContext } from '../types.js';
import type { MarketSnapshot } from '../../dtos/market-snapshot.dto.js';
import { computeOrderApy } from '../helpers/market-apy.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../../../config/market-providers.js';

const MARKET_GUID = 'tron-pulse';

interface LiquidityResponse {
  data: {
    total: number;
    available: number;
  };
}

interface MarketSettingsResponse {
  data: {
    energy_display_price: number;
    energy_duration: Array<{
      block_duration: number;
      energy_min_price: number;
    }>;
  };
}

interface OrdersResponse {
  data: {
    market_orders: Array<{
      status: string;
      ressource: string;
      created_date: number | string;
      duration: number;
      duration_unit: 'day' | 'hour';
      amount: number;
      payout: number;
    }>;
  };
}

interface OrderSnapshot {
  energy: number;
  created: number | undefined;
  duration: number;
  payment: number;
  buyerAPY: number | undefined;
  sellerAPY: number | undefined;
}

export class TronPulseFetcher extends BaseMarketFetcher {
  private readonly config = marketProviderConfig.tronPulse;

  constructor() {
    super({ name: 'Tron Pulse', guid: MARKET_GUID });
  }

  private buildHeaders() {
    const referer = this.config.siteLinks?.[0]?.link ?? 'https://tronpulse.io';
    let origin = 'https://tronpulse.io';
    try {
      origin = new URL(referer).origin;
    } catch {
      origin = 'https://tronpulse.io';
    }
    return {
      'Content-Type': 'application/json',
      Referer: referer,
      Origin: origin,
      'X-Requested-With': 'XMLHttpRequest'
    } as const;
  }

  private async fetchOrders(context: MarketFetcherContext): Promise<OrderSnapshot[]> {
    const response = await executeWithRetry(
      () =>
        context.http.get<OrdersResponse>(this.config.endpoints.orders, {
          timeout: this.timeoutMs,
          headers: this.buildHeaders()
        }),
      {
        logger: context.logger,
        fetcher: this.name,
        marketGuid: this.guid,
        requestLabel: 'orders'
      }
    );

    const orders = response.data.data?.market_orders ?? [];
    const snapshots: OrderSnapshot[] = [];

    for (const order of orders) {
      if (order.status !== 'open' || order.ressource !== 'energy') {
        continue;
      }

      const durationSeconds =
        order.duration_unit === 'day'
          ? order.duration * 24 * 60 * 60
          : order.duration * 60 * 60;
      const paymentSun = order.payout * 1_000_000;

      const buyerAPY = computeOrderApy({
        trEnergy: context.chainParameters,
        energy: order.amount,
        paymentSun,
        durationSeconds,
        deductFee: false
      });
      const sellerAPY = computeOrderApy({
        trEnergy: context.chainParameters,
        energy: order.amount,
        paymentSun,
        durationSeconds,
        deductFee: true
      });

      snapshots.push({
        energy: order.amount,
        created: typeof order.created_date === 'string' ? Date.parse(order.created_date) : order.created_date,
        duration: durationSeconds,
        payment: paymentSun,
        buyerAPY,
        sellerAPY
      });
    }

    return snapshots;
  }

  async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    const headers = this.buildHeaders();

    const results = await Promise.allSettled([
      executeWithRetry(
        () =>
          context.http.get<LiquidityResponse>(this.config.endpoints.liquidity, {
            timeout: this.timeoutMs,
            headers
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'liquidity'
        }
      ),
      executeWithRetry(
        () =>
          context.http.get<MarketSettingsResponse>(this.config.endpoints.settings, {
            timeout: this.timeoutMs,
            headers
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'settings'
        }
      ),
      this.fetchOrders(context)
    ]);

    const [liquidityResult, settingsResult, ordersResult] = results;

    const liquidity =
      liquidityResult.status === 'fulfilled' ? liquidityResult.value.data?.data ?? null : null;
    const settings =
      settingsResult.status === 'fulfilled' ? settingsResult.value.data?.data ?? null : null;
    const orders = ordersResult.status === 'fulfilled' ? ordersResult.value : [];

    let orderMaxBuyerAPY: number | undefined;
    let orderMaxSellerAPY: number | undefined;

    for (const order of orders) {
      if (order.buyerAPY !== undefined) {
        orderMaxBuyerAPY = orderMaxBuyerAPY === undefined ? order.buyerAPY : Math.max(orderMaxBuyerAPY, order.buyerAPY);
      }
      if (order.sellerAPY !== undefined) {
        orderMaxSellerAPY = orderMaxSellerAPY === undefined ? order.sellerAPY : Math.max(orderMaxSellerAPY, order.sellerAPY);
      }
    }

    const fees = (settings?.energy_duration ?? [])
      .map(duration => {
        let minutes: number | null = null;
        if (duration.block_duration === 1_200) {
          minutes = 60;
        } else if (duration.block_duration === 28_800) {
          minutes = 60 * 24;
        } else if (duration.block_duration === 86_400) {
          minutes = 60 * 24 * 3;
        }

        if (!minutes) {
          return null;
        }

        const apyValue = context.chainParameters?.getAPY?.(1_000_000, duration.energy_min_price, minutes / (60 * 24));

        return {
          minutes,
          sun: duration.energy_min_price,
          ...(typeof apyValue === 'number' && Number.isFinite(apyValue) ? { apy: apyValue } : {})
        };
      })
      .filter((entry): entry is { minutes: number; sun: number; apy?: number } => entry !== null);

    const snapshot: MarketSnapshot = {
      guid: this.guid,
      name: this.name,
      priority: 4,
      energy: {
        total: liquidity?.total ?? 0,
        available: liquidity?.available ?? 0,
        minOrder: this.config.minOrder ?? 32_000
      },
      siteLinks: this.config.siteLinks,
      social: this.config.social,
      addresses: this.config.addresses ?? [],
      fees,
      orders,
      description:
        'Tronpulse.io is a peer-to-peer energy exchange built on the TRON blockchain, designed to align buyers and sellers of energy.',
      iconHtml: '<img class="img-fluid" src="/images/site-icons/tronpulse.png" alt="Tron Pulse Energy Market" />',
      stats: {
        orderMaxBuyerAPY,
        orderMaxSellerAPY
      },
      isActive: true,
      metadata: {
        source: 'tron-pulse',
        liquidityEndpoint: this.config.endpoints.liquidity,
        settingsEndpoint: this.config.endpoints.settings,
        ordersEndpoint: this.config.endpoints.orders
      }
    };

    return snapshot;
  }
}
