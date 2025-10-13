import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketFetcherContext } from '../types.js';
import type { MarketSnapshot } from '../../dtos/market-snapshot.dto.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../../../config/market-providers.js';

const MARKET_GUID = 'mefreenet';

interface MeFreeResponse {
  energy_remaining: string;
  trx_price?: string; // Price per energy unit in SUN (appears unreliable, not used)
}

export class MeFreeNetFetcher extends BaseMarketFetcher {
  private readonly config = marketProviderConfig.meFreeNet;

  constructor() {
    super({ name: 'MeFree.Net', guid: MARKET_GUID, schedule: '*/10 * * * *' });
  }

  /**
   * Parses pricing information from a single MeFree.net page (any language).
   * Extracts the TRX price per transaction, energy amount per transaction, and rental duration.
   *
   * @param html - Raw HTML content from mefree.net
   * @param language - Language identifier for logging
   * @returns Pricing data with TRX amount, energy per transaction, and duration in minutes
   */
  private parsePricingFromHtml(html: string, language: string): {
    priceTrx: number;
    energyAmount: number;
    durationMinutes: number;
    language: string;
  } | null {
    // Parse energy amount from <i> tag followed by "能量" (Chinese) or "energy" (English/Russian)
    // Chinese: "每笔等于 <i> 65000 </i> 能量"
    // English: "<i> 65000 </i> energy per transaction"
    // Must match 5+ digit numbers to avoid matching step numbers like "01"
    const energyMatch = html.match(/<i>[\s\S]*?(\d{5,}(?:,\d+)*)[\s\S]*?<\/i>[\s\S]{0,50}(?:能量|energy)/i);

    if (!energyMatch) {
      return null;
    }

    const energyAmount = parseInt(energyMatch[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(energyAmount)) {
      return null;
    }

    // Parse pricing from <option> element
    // Chinese: <option value="3" id="times">单价 3 TRX / 1 小时</option>
    // English: <option value="5" id="times">5 TRX / 1 hours</option>
    const priceMatch = html.match(/<option[^>]*id="times"[^>]*>[\s\S]*?(\d+(?:\.\d+)?)\s*TRX\s*\/\s*(\d+)\s*(?:小时|hours?)[\s\S]*?<\/option>/i);

    if (!priceMatch) {
      return null;
    }

    const priceTrx = parseFloat(priceMatch[1]);
    const durationHours = parseInt(priceMatch[2], 10);

    if (!Number.isFinite(priceTrx) || !Number.isFinite(durationHours)) {
      return null;
    }

    return {
      priceTrx,
      energyAmount,
      durationMinutes: durationHours * 60,
      language
    };
  }

  async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    // Fetch energy availability from API
    const response = await executeWithRetry(
      () =>
        context.http.get<MeFreeResponse>(this.config.endpoints.info, {
          timeout: this.timeoutMs
        }),
      {
        logger: context.logger,
        fetcher: this.name,
        marketGuid: this.guid,
        requestLabel: 'info'
      }
    );

    const availableEnergy = response.data?.energy_remaining
      ? Number(response.data.energy_remaining.replace(/,/g, ''))
      : 0;

    const parsedAvailable = Number.isFinite(availableEnergy) ? availableEnergy : 0;

    // Fetch pricing from both Chinese and English versions to capture differential pricing
    // Chinese version: https://mefree.net/ (typically 3 TRX)
    // English version: https://mefree.net/en/ (typically 5 TRX)
    const [chineseHtml, englishHtml] = await Promise.all([
      executeWithRetry(
        () =>
          context.http.get<string>('https://mefree.net/', {
            timeout: this.timeoutMs,
            responseType: 'text'
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'pricing-zh'
        }
      ),
      executeWithRetry(
        () =>
          context.http.get<string>('https://mefree.net/en/', {
            timeout: this.timeoutMs,
            responseType: 'text'
          }),
        {
          logger: context.logger,
          fetcher: this.name,
          marketGuid: this.guid,
          requestLabel: 'pricing-en'
        }
      )
    ]);

    // Parse pricing from both language versions
    const chinesePricing = this.parsePricingFromHtml(chineseHtml.data, 'zh');
    const englishPricing = this.parsePricingFromHtml(englishHtml.data, 'en');

    // Collect all unique pricing tiers
    const allPricing = [chinesePricing, englishPricing].filter(p => p !== null);

    // Build fees array from all discovered pricing tiers
    // Note: MeFree.net prices are per full transaction (65k energy), not per energy unit
    // So we store the sun as the total TRX cost, not per-unit
    const fees = allPricing.length > 0
      ? allPricing.map(pricing => ({
          minutes: pricing.durationMinutes,
          sun: (pricing.priceTrx * 1_000_000) / pricing.energyAmount,
          energyAmount: pricing.energyAmount,
          description: `${pricing.priceTrx} TRX (${pricing.language === 'zh' ? 'Chinese site' : 'English site'})`
        }))
      : undefined;

    const snapshot: MarketSnapshot = {
      guid: this.guid,
      name: this.name,
      priority: 100,
      energy: {
        total: 0,  // MeFree.net doesn't provide total capacity, only current available
        available: parsedAvailable
      },
      fees,
      addresses: this.config.addresses ?? [],
      siteLinks: this.config.siteLinks,
      description:
        'The mefree.net platform is an energy exchange platform in the TRON ecosystem. With an energy pool around 200 million and growing, it helps reduce TRX fees for energy consumption on TRON.',
      iconHtml: '<img class="img-fluid" src="/images/site-icons/mefreenet.png" alt="MeFree.Net Tron Energy Rental Market" />',
      isActive: true,
      metadata: {
        source: 'mefree-net',
        infoEndpoint: this.config.endpoints.info,
        apiReportedPrice: response.data?.trx_price,
        differentialPricing: {
          chinese: chinesePricing,
          english: englishPricing,
          note: 'MeFree.net charges different prices based on language/region'
        }
      }
    };

    return snapshot;
  }
}
