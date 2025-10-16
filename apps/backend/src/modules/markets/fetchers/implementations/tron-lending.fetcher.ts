import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketFetcherContext } from '../types.js';
import type { MarketSnapshot } from '../../dtos/market-snapshot.dto.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../../../config/market-providers.js';

const MARKET_GUID = 'tron-lending';

/**
 * Response from /resources/info endpoint containing 4 hex-encoded fields
 */
interface TronLendingInfoResponse {
    status: string;
    data: [string];
}

/**
 * Response from /price/rate endpoint containing 10 hex-encoded pricing configuration fields
 */
interface TronLendingRateResponse {
    status: string;
    data: [string];
}

/**
 * Decode a hex string segment to TRX amount
 * @param segment - Hex string (without 0x prefix)
 * @returns TRX amount (hex value divided by 1,000,000)
 */
function decodeHexAmount(segment: string): number {
    if (!segment) {
        return 0;
    }
    const parsed = parseInt(`0x${segment}`, 16);
    return Number.isFinite(parsed) ? parsed / 1_000_000 : 0;
}

/**
 * Decode a hex string to raw numeric value (without TRX conversion)
 * @param segment - Hex string (without 0x prefix)
 * @returns Raw numeric value
 */
function decodeHexValue(segment: string): number {
    if (!segment) {
        return 0;
    }
    const parsed = parseInt(`0x${segment}`, 16);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Split a hex string into 64-character (32-byte) chunks
 * @param hexString - Concatenated hex string
 * @returns Array of hex chunks
 */
function splitHexFields(hexString: string): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < hexString.length; i += 64) {
        chunks.push(hexString.substring(i, i + 64));
    }
    return chunks;
}

export class TronLendingFetcher extends BaseMarketFetcher {
    private readonly config = marketProviderConfig.tronLending;

    constructor() {
        super({ name: 'Tron Lending', guid: MARKET_GUID });
    }

    /**
     * Fetch and normalize market data from Tron Lending
     * Combines data from /resources/info and /price/rate endpoints
     * @param context - Market fetcher context with HTTP client and TR Energy adapter
     * @returns Complete market snapshot with energy availability and pricing tiers
     */
    async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
        // Fetch resource info (energy availability)
        const infoResponse = await executeWithRetry(
            () =>
                context.http.get<TronLendingInfoResponse>(this.config.endpoints.info, {
                    timeout: this.timeoutMs
                }),
            {
                logger: context.logger,
                fetcher: this.name,
                marketGuid: this.guid,
                requestLabel: 'info'
            }
        );

        // Fetch pricing configuration
        let rateData: TronLendingRateResponse | null = null;
        try {
            const rateResponse = await executeWithRetry(
                () =>
                    context.http.get<TronLendingRateResponse>(this.config.endpoints.rate, {
                        timeout: this.timeoutMs
                    }),
                {
                    logger: context.logger,
                    fetcher: this.name,
                    marketGuid: this.guid,
                    requestLabel: 'rate'
                }
            );
            rateData = rateResponse.data;
        } catch (error) {
            context.logger.warn({ error, fetcher: this.name }, 'Failed to fetch rate data, continuing with info only');
        }

        // Parse /resources/info response (4 fields)
        const infoPayload = infoResponse.data?.data?.[0] ?? '';
        const infoFields = splitHexFields(infoPayload);

        let totalEnergy = 0;
        let availableEnergy = 0;
        let field3Trx = 0;
        let field4Trx = 0;

        if (infoFields.length >= 4) {
            const availableTrx = decodeHexAmount(infoFields[0]);
            const totalTrx = decodeHexAmount(infoFields[1]);
            field3Trx = decodeHexAmount(infoFields[2]);
            field4Trx = decodeHexAmount(infoFields[3]);

            if (context.chainParameters) {
                availableEnergy = context.chainParameters.getEnergyFromTRX(availableTrx) || 0;
                totalEnergy = context.chainParameters.getEnergyFromTRX(totalTrx) || 0;
            }
        }

        // Parse /price/rate response (10 fields with pricing config)
        let baseRate = 80; // Default from observed transactions
        const rateFields: number[] = [];

        if (rateData?.data?.[0]) {
            const ratePayload = rateData.data[0];
            const rateHexFields = splitHexFields(ratePayload);

            rateHexFields.forEach(field => {
                rateFields.push(decodeHexValue(field));
            });

            // Field 5 contains the base rate (80 SUN observed)
            if (rateFields.length >= 5 && rateFields[4] > 0) {
                baseRate = rateFields[4];
            }
        }

        // Build pricing tiers based on observed price table (8 durations: 1-30 days)
        // Prices decrease with longer durations following the observed pattern
        const fees = [
            { minutes: 60 * 24 * 1, sun: baseRate },                    // 1 day @ 80 SUN
            { minutes: 60 * 24 * 3, sun: Math.round(baseRate * 0.98) }, // 3 days @ ~78 SUN
            { minutes: 60 * 24 * 7, sun: Math.round(baseRate * 0.94) }, // 7 days @ ~75 SUN
            { minutes: 60 * 24 * 10, sun: Math.round(baseRate * 0.91) }, // 10 days @ ~73 SUN
            { minutes: 60 * 24 * 15, sun: Math.round(baseRate * 0.86) }, // 15 days @ ~69 SUN
            { minutes: 60 * 24 * 20, sun: Math.round(baseRate * 0.81) }, // 20 days @ ~65 SUN
            { minutes: 60 * 24 * 25, sun: Math.round(baseRate * 0.76) }, // 25 days @ ~61 SUN
            { minutes: 60 * 24 * 30, sun: Math.round(baseRate * 0.71) }  // 30 days @ ~57 SUN
        ];

        const snapshot: MarketSnapshot = {
            guid: this.guid,
            name: this.name,
            priority: 121,
            energy: {
                total: Math.max(0, Math.floor(totalEnergy)),
                available: Math.max(0, Math.floor(availableEnergy))
            },
            fees,
            addresses: this.config.addresses ?? [],
            social: this.config.social,
            siteLinks: this.config.siteLinks,
            description:
                'TRON Lending Services offers competitive fees with secure, seamless transaction processing for resource rentals.',
            iconHtml: '<img class="img-fluid" src="/images/site-icons/tronlending.png" alt="Tron Lending Energy Market" />',
            contract: 'TMjay2KsxKTtfY5odNTL8ivYxDZkxcnnYc',
            isActive: true,
            metadata: {
                source: 'tron-lending',
                infoEndpoint: this.config.endpoints.info,
                rateEndpoint: this.config.endpoints.rate,
                infoFields: {
                    availableTrx: infoFields.length >= 1 ? decodeHexAmount(infoFields[0]) : 0,
                    totalTrx: infoFields.length >= 2 ? decodeHexAmount(infoFields[1]) : 0,
                    field3Trx,
                    field4Trx
                },
                rateFields: rateFields.length > 0 ? rateFields : undefined,
                baseRateSun: baseRate
            }
        };

        return snapshot;
    }
}
