import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketFetcherContext } from '../types.js';
import type { MarketSnapshot } from '../../dtos/market-snapshot.dto.js';
import { computeOrderApy } from '../helpers/market-apy.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../../../config/market-providers.js';

const MARKET_GUID = 'tronify';

interface TronifyTradesResponse {
  data: {
    data: Array<{
      orderType: string;
      createTime: string;
      pledgeDay: string;
      pledgeHour: string;
      pledgeMinute: string;
      pledgeNum: number;
      canSaleTrxNum: number;
    }>;
  };
}

interface TronifyPledgeConfigResponse {
  resCode: number;
  resMsg: string;
  data: {
    sun_10m: number;
    sun_1h: number;
    sun_3h: number;
    sun_1d: number;
    sun_2d: number;
    sun_1h_transfer: number;
    defaultDay: number;
    defaultEnergyPrice: number;
    serviceFeeLimit: number;
    treasureType: Array<{
      type: string;
      value: string;
    }>;
    lowEneygyFee: number;
  };
}

export class TronifyFetcher extends BaseMarketFetcher {
  private readonly config = marketProviderConfig.tronify;

  constructor() {
    super({ name: 'Tronify', guid: MARKET_GUID });
  }

  async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    // Fetch EnergyPal pricing configuration
    const pledgeConfigResponse = await executeWithRetry(
      () =>
        context.http.post<TronifyPledgeConfigResponse>(
          this.config.endpoints.pledgeConfig,
          {
            sourceFlag: 'tronify',
            invitationCode: '',
            utmSource: '',
            connectWalletType: 'TronLink'
          },
          { timeout: this.timeoutMs }
        ),
      {
        logger: context.logger,
        fetcher: this.name,
        marketGuid: this.guid,
        requestLabel: 'pledgeConfig'
      }
    );

    const response = await executeWithRetry(
      () =>
        context.http.post<TronifyTradesResponse>(
          this.config.endpoints.trades,
          {
            sort: '1',
            page: 1,
            pageSize: 100,
            orderType: '',
            sourceFlag: 'tronify',
            invitationCode: '',
            utmSource: ''
          },
          { timeout: this.timeoutMs }
        ),
      {
        logger: context.logger,
        fetcher: this.name,
        marketGuid: this.guid,
        requestLabel: 'trades'
      }
    );

    const orders = response.data?.data?.data ?? [];
    let orderMaxBuyerAPY: number | undefined;
    let orderMaxSellerAPY: number | undefined;

    const orderSnapshots = orders
      .filter(order => order.orderType === 'ENERGY')
      .map(order => {
        const days = Number(order.pledgeDay) || 0;
        const hours = Number(order.pledgeHour) || 0;
        const minutes = Number(order.pledgeMinute) || 0;
        const durationSeconds = days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60;
        const paymentSun = (Number(order.canSaleTrxNum) || 0) * 1_000_000;

        const buyerAPY = computeOrderApy({
          trEnergy: context.chainParameters,
          energy: order.pledgeNum,
          paymentSun,
          durationSeconds,
          deductFee: false
        });
        const sellerAPY = computeOrderApy({
          trEnergy: context.chainParameters,
          energy: order.pledgeNum,
          paymentSun,
          durationSeconds,
          deductFee: true
        });

        if (buyerAPY !== undefined) {
          orderMaxBuyerAPY = orderMaxBuyerAPY === undefined ? buyerAPY : Math.max(orderMaxBuyerAPY, buyerAPY);
        }
        if (sellerAPY !== undefined) {
          orderMaxSellerAPY = orderMaxSellerAPY === undefined ? sellerAPY : Math.max(orderMaxSellerAPY, sellerAPY);
        }

        return {
          energy: order.pledgeNum,
          created: Date.parse(order.createTime),
          duration: durationSeconds,
          payment: paymentSun,
          buyerAPY,
          sellerAPY
        };
      });

    // Build EnergyPal pricing tiers from pledgeConfig
    const pledgeConfig = pledgeConfigResponse.data?.data;
    const fees = pledgeConfig
      ? [
          {
            minutes: 10,
            sun: pledgeConfig.sun_10m,
            description: 'EnergyPal: 10 minutes',
            type: 'energypal'
          },
          {
            minutes: 60,
            sun: pledgeConfig.sun_1h,
            description: 'EnergyPal: 1 hour',
            type: 'energypal'
          },
          {
            minutes: 180,
            sun: pledgeConfig.sun_3h,
            description: 'EnergyPal: 3 hours',
            type: 'energypal'
          },
          {
            minutes: 1440,
            sun: pledgeConfig.sun_1d,
            description: 'EnergyPal: 1 day',
            type: 'energypal'
          },
          {
            minutes: 2880,
            sun: pledgeConfig.sun_2d,
            description: 'EnergyPal: 2 days',
            type: 'energypal'
          },
          {
            minutes: pledgeConfig.defaultDay * 1440,
            sun: pledgeConfig.defaultEnergyPrice,
            description: `EnergyPal: ${pledgeConfig.defaultDay} days (default)`,
            type: 'energypal'
          }
        ]
      : undefined;

    const snapshot: MarketSnapshot = {
      guid: this.guid,
      name: this.name,
      priority: 100,
      energy: {
        total: 0,
        available: 0
      },
      siteLinks: this.config.siteLinks,
      social: this.config.social,
      addresses: this.config.addresses ?? [],
      orders: orderSnapshots,
      fees,
      description: 'Using energy instead of TRX can save up to 70% in fees.',
      iconHtml: '<img class="img-fluid" src="/images/site-icons/tronify.svg" alt="Tronify Energy Rental Market" />',
      stats: {
        orderMaxBuyerAPY,
        orderMaxSellerAPY
      },
      isActive: true,
      metadata: {
        source: 'tronify',
        tradesEndpoint: this.config.endpoints.trades,
        pledgeConfigEndpoint: this.config.endpoints.pledgeConfig,
        serviceFeeLimit: pledgeConfig?.serviceFeeLimit,
        energyPerTransfer: pledgeConfig?.treasureType?.find((t) => t.type === 'transfer')?.value,
        serviceFee: pledgeConfig?.lowEneygyFee
      }
    };

    return snapshot;
  }
}
