import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketFetcherContext } from '../types.js';
import type { MarketSnapshot } from '../../dtos/market-snapshot.dto.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../../../config/market-providers.js';

const MARKET_GUID = 'apitrx';

interface FeeRow {
  minutes: number;
  sun: number;
}

function extractFees(html: string): FeeRow[] {
  const tableMatch = /<table[\s\S]*?<\/table>/i.exec(html);
  if (!tableMatch) {
    return [];
  }

  const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const fees: FeeRow[] = [];

  for (const row of rows) {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi);
    if (!cells || cells.length < 3) {
      continue;
    }

    const [energyCell, durationCell, priceCell] = cells.map(cell => cell.replace(/<[^>]+>/g, '').trim());
    const energy = Number(energyCell.replace(/[^0-9.]/g, ''));
    const priceTrx = Number(priceCell.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(energy) || !Number.isFinite(priceTrx) || energy <= 0) {
      continue;
    }

    let minutes = 0;
    if (/hour/i.test(durationCell)) {
      minutes = Number(durationCell.replace(/[^0-9]/g, '')) * 60;
    } else if (/day/i.test(durationCell)) {
      minutes = Number(durationCell.replace(/[^0-9]/g, '')) * 60 * 24;
    }

    if (!minutes) {
      continue;
    }

    const hours = minutes / 60;
    const days = minutes / (60 * 24);
    const divisor = minutes < 60 * 24 ? hours : days;
    const sun = (priceTrx / energy) * 1_000_000 / divisor;

    fees.push({ minutes, sun });
  }

  return fees;
}

export class ApiTrxFetcher extends BaseMarketFetcher {
  private readonly config = marketProviderConfig.apiTrx;

  constructor() {
    super({ name: 'Api TRX', guid: MARKET_GUID, schedule: '*/10 * * * *' });
  }

  async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    const response = await executeWithRetry(
      () =>
        context.http.get<string>(this.config.endpoints.price, {
          timeout: this.timeoutMs,
          responseType: 'text'
        }),
      {
        logger: context.logger,
        fetcher: this.name,
        marketGuid: this.guid,
        requestLabel: 'price'
      }
    );

    const html = response.data ?? '';
    const fees = extractFees(html).map(fee => ({
      minutes: fee.minutes,
      sun: fee.sun,
      apy: context.chainParameters?.getAPY?.(1_000_000, fee.sun, fee.minutes / (60 * 24))
    }));

    const snapshot: MarketSnapshot = {
      guid: this.guid,
      name: this.name,
      priority: 1000,
      energy: {
        total: 0,
        available: 0
      },
      siteLinks: this.config.siteLinks,
      social: this.config.social,
      addresses: this.config.addresses ?? [],
      fees,
      description:
        'API-first Tron energy market. Call via API or on-chain interface with no UI required. Send TRX to the ApiTRX address and receive energy within seconds.',
      iconHtml: '<img class="img-fluid" src="/images/site-icons/apitrx.png" alt="Api TRX" />',
      isActive: true,
      metadata: {
        source: 'api-trx',
        priceEndpoint: this.config.endpoints.price
      }
    };

    return snapshot;
  }
}
