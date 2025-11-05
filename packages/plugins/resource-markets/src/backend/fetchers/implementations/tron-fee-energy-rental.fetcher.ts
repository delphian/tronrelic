import type { IPluginContext } from '@tronrelic/types';
import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketSnapshot } from '../../../shared/types/market-snapshot.dto.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../config/market-providers.js';

const MARKET_GUID = 'tron-fee-energy-rental';

/**
 * Pricing configuration structure embedded in window.AppSettings
 */
interface ToFeePricingConfig {
    rates: {
        tenMin: number;
        oneHour: number;
        oneDay: number;
    };
}

/**
 * Extract window.AppSettings object from HTML script tags
 * @param html - HTML content from tofee.net homepage
 * @returns Parsed pricing configuration or null if not found
 */
function extractPricingConfig(html: string): ToFeePricingConfig | null {
    // Match window.AppSettings with nested object, handling multiline and whitespace
    const settingsRegex = /window\.AppSettings\s*=\s*\{[\s\S]*?rates\s*:\s*\{[\s\S]*?tenMin\s*:\s*([\d.]+)[,\s]*oneHour\s*:\s*([\d.]+)[,\s]*oneDay\s*:\s*([\d.]+)/i;
    const match = settingsRegex.exec(html);

    if (!match) {
        return null;
    }

    try {
        const tenMin = parseFloat(match[1]);
        const oneHour = parseFloat(match[2]);
        const oneDay = parseFloat(match[3]);

        if (!Number.isFinite(tenMin) || !Number.isFinite(oneHour) || !Number.isFinite(oneDay)) {
            return null;
        }

        return {
            rates: {
                tenMin,
                oneHour,
                oneDay
            }
        };
    } catch {
        return null;
    }
}

export class TronFeeEnergyRentalFetcher extends BaseMarketFetcher {
    private readonly config = marketProviderConfig.tronFeeEnergyRental;

    constructor(context: IPluginContext) {
        super(context, { name: 'Tron Fee Energy Rental', guid: MARKET_GUID });
    }

    /**
     * Fetch and normalize market data from Tron Fee Energy Rental
     * Extracts energy availability from HTML input field and pricing tiers from window.AppSettings
     * @returns Complete market snapshot with energy availability and pricing tiers
     */
    async pull(): Promise<MarketSnapshot | null> {
        const response = await executeWithRetry(
            () =>
                this.context.http.get<string>(this.config.endpoints.home, {
                    timeout: this.timeoutMs,
                    responseType: 'text'
                }),
            {
                logger: this.context.logger,
                fetcher: this.name,
                marketGuid: this.guid,
                requestLabel: 'home'
            }
        );

        const html = response.data ?? '';

        // Extract available energy from input field
        const energyRegex = /<input aria-label="numbertwo" type="text" value="([^"]+)" class="input-number2" disabled>/i;
        const energyMatch = energyRegex.exec(html);
        const availableEnergy = energyMatch ? Number(energyMatch[1].replace(/,/g, '')) : 0;
        const parsedAvailable = Number.isFinite(availableEnergy) ? availableEnergy : 0;

        // Extract pricing configuration from window.AppSettings
        // ToFee prices are per USDT transaction, need to normalize to per-energy pricing
        // Use dynamic USDT energy cost from blockchain instead of hardcoded 65_000
        const energyPerTransaction = await this.context.usdtParameters.getStandardTransferEnergy();
        const pricingConfig = extractPricingConfig(html);
        const fees = pricingConfig
            ? [
                  {
                      minutes: 10,
                      sun: Math.round((pricingConfig.rates.tenMin * 1_000_000) / energyPerTransaction),
                      description: 'ToFee: 10 minutes',
                      type: 'fixed-rate'
                  },
                  {
                      minutes: 60,
                      sun: Math.round((pricingConfig.rates.oneHour * 1_000_000) / energyPerTransaction),
                      description: 'ToFee: 1 hour',
                      type: 'fixed-rate'
                  },
                  {
                      minutes: 1440,
                      sun: Math.round((pricingConfig.rates.oneDay * 1_000_000) / energyPerTransaction),
                      description: 'ToFee: 1 day',
                      type: 'fixed-rate'
                  }
              ]
            : undefined;

        const snapshot: MarketSnapshot = {
            guid: this.guid,
            name: this.name,
            priority: 100,
            energy: {
                total: parsedAvailable,
                available: parsedAvailable
            },
            fees,
            addresses: this.config.addresses ?? [],
            social: this.config.social,
            siteLinks: this.config.siteLinks,
            description:
                'Our goal is to reduce the TRX fee required for energy consumption. The process is simple and fast at a favorable price, offering a safer and more efficient energy exchange service.',
            iconHtml: '<img class="img-fluid" src="/images/site-icons/tronfeeenergyrental.png" alt="Tron Fee Energy Rental Market" />',
            isActive: true,
            metadata: {
                source: 'tron-fee-energy-rental',
                homeEndpoint: this.config.endpoints.home,
                energyPerTransaction,
                deliveryTimeSeconds: 6,
                paymentMethods: ['TRX', 'USDT'],
                noDailyLimit: true,
                pricingRates: pricingConfig?.rates
            }
        };

        return snapshot;
    }
}
