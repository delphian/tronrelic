import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketFetcherContext } from '../types.js';
import type { MarketSnapshot } from '../../dtos/market-snapshot.dto.js';
import { computeOrderApy } from '../helpers/market-apy.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../../../config/market-providers.js';

const MARKET_GUID = 'nitron-energy';

interface NitronInfoResponse {
  totalEnergyNow: number;
  totalEnergy: number;
}

interface OrderSnapshot {
  energy: number;
  created?: number;
  duration: number;
  payment: number;
  buyerAPY: number | undefined;
  sellerAPY: number | undefined;
}

function extractFeeSun(html: string): number | undefined {
  const match = /window.MinPriceDaysSun\s*=\s*(\d+);/i.exec(html);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function extractOrders(html: string, context: MarketFetcherContext): OrderSnapshot[] {
  const orderRegex = /<div class="col-6 col-md-3 col-lg-3 mb-4 openOrders" id="openOrders_\d{3}">(.*?)<div class="cart-hover">/gsi;
  const payoutRegex = /<div class="freelancers-price">(\d+) TRX Payout<\/div>/i;
  const durationRegex = /<input type="number" id="lockperiod_\d+" value="(\d+)" style="display:none"\/>/i;
  const energyRegex = /<div class="freelancers-price" id="EnergyRequired_\d+" data-energyrequired="(\d+)">/i;

  const orders: OrderSnapshot[] = [];
  let match: RegExpExecArray | null;

  while ((match = orderRegex.exec(html)) !== null) {
    const section = match[1];
    const payoutMatch = payoutRegex.exec(section);
    const durationMatch = durationRegex.exec(section);
    const energyMatch = energyRegex.exec(section);

    if (!payoutMatch || !durationMatch || !energyMatch) {
      continue;
    }

    const payoutTrx = Number(payoutMatch[1]);
    const durationBase = Number(durationMatch[1]);
    const energy = Number(energyMatch[1]);

    if (!Number.isFinite(payoutTrx) || !Number.isFinite(durationBase) || !Number.isFinite(energy)) {
      continue;
    }

    const durationSeconds = durationBase * 3;
    const paymentSun = payoutTrx * 1_000_000;

    const buyerAPY = computeOrderApy({
      trEnergy: context.chainParameters,
      energy,
      paymentSun,
      durationSeconds,
      deductFee: false
    });
    const sellerAPY = computeOrderApy({
      trEnergy: context.chainParameters,
      energy,
      paymentSun,
      durationSeconds,
      deductFee: true
    });

    orders.push({
      energy,
      duration: durationSeconds,
      payment: paymentSun,
      buyerAPY,
      sellerAPY
    });
  }

  return orders;
}

export class NitronEnergyFetcher extends BaseMarketFetcher {
  private readonly config = marketProviderConfig.nitronEnergy;

  constructor() {
    super({ name: 'NiTron Energy', guid: MARKET_GUID, schedule: '*/10 * * * *' });
  }

  async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    const [infoResponse, homeResponse] = await Promise.all([
      executeWithRetry(
        () =>
          context.http.get<NitronInfoResponse>(this.config.endpoints.info, {
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
          context.http.get<string>(this.config.endpoints.home, {
            timeout: this.timeoutMs,
            responseType: 'text'
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'home'
        }
      )
    ]);

    const info = infoResponse.data ?? { totalEnergyNow: 0, totalEnergy: 0 };
    const html = homeResponse.data ?? '';

    const fee24h = extractFeeSun(html);
    const orders = extractOrders(html, context);

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

    const snapshot: MarketSnapshot = {
      guid: this.guid,
      name: this.name,
      priority: 6,
      energy: {
        total: info.totalEnergy ?? 0,
        available: info.totalEnergyNow ?? 0
      },
      siteLinks: this.config.siteLinks,
      social: this.config.social,
      addresses: this.config.addresses ?? [],
      fees: fee24h
        ? [
            {
              minutes: 60 * 24,
              sun: fee24h,
              apy: context.chainParameters?.getAPY?.(1_000_000, fee24h, 1)
            }
          ]
        : undefined,
      orders,
      description:
        'Driving innovation through advanced P2P energy rental services, NiTron offers a high-throughput platform tailored for substantial energy demands.',
      iconHtml: '<img class="img-fluid" src="/images/site-icons/nitron-energy-small.jpeg" alt="Nitron Energy Rental Site" />',
      stats: {
        orderMaxBuyerAPY,
        orderMaxSellerAPY
      },
      isActive: true,
      metadata: {
        source: 'nitron-energy',
        infoEndpoint: this.config.endpoints.info,
        homeEndpoint: this.config.endpoints.home
      }
    };

    return snapshot;
  }
}
