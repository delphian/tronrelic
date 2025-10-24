import type { ILogger } from '@tronrelic/types';
import type { IMarketQueryOptions } from '../shared/index.js';

/**
 * Market data response from backend API.
 */
interface IMarketResponse {
    success: boolean;
    markets: IMarket[];
}

/**
 * Market provider data with pricing details.
 */
interface IMarket {
    guid: string;
    name: string;
    isActive: boolean;
    lastUpdated: Date;
    pricingDetail?: {
        minUsdtTransferCost?: number;
        usdtTransferCosts?: Array<{
            durationMinutes: number;
            costTrx: number;
        }>;
    };
}

/**
 * Service for querying market data and formatting responses for Telegram bot.
 * Handles API calls to the markets endpoint and cost calculations based on user requests.
 *
 * Why this service exists:
 * Market data lives in the backend API, but the Telegram bot needs to access it without
 * tight coupling. This service abstracts the API call and provides formatted responses
 * suitable for Telegram messages.
 */
export class MarketQueryService {
    private readonly apiBaseUrl: string;

    /**
     * Creates a market query service.
     *
     * @param apiBaseUrl - Base URL for backend API (e.g., 'http://localhost:4000/api')
     * @param logger - Logger instance for debugging and error tracking
     *
     * Why baseUrl is configurable:
     * In production, backend might be on different host. In Docker, it's 'http://backend:4000'.
     * Making this configurable enables testing and deployment flexibility.
     */
    constructor(
        apiBaseUrl: string,
        private readonly logger: ILogger
    ) {
        this.apiBaseUrl = apiBaseUrl;
    }

    /**
     * Fetches current market data from the backend API.
     * Makes HTTP request to /api/markets endpoint.
     *
     * @returns Market data array or empty array on error
     *
     * Why error handling returns empty array:
     * Telegram bot should respond gracefully even if API is temporarily unavailable.
     * Empty array triggers "no markets available" message instead of crashing.
     */
    private async fetchMarkets(): Promise<IMarket[]> {
        try {
            // Use dynamic import to avoid bundling issues
            const axios = (await import('axios')).default;

            const response = await axios.get<IMarketResponse>(`${this.apiBaseUrl}/markets`, {
                timeout: 5000
            });

            if (!response.data.success) {
                this.logger.error('Markets API returned success: false');
                return [];
            }

            return response.data.markets;
        } catch (error) {
            this.logger.error({ error }, 'Failed to fetch markets');
            return [];
        }
    }

    /**
     * Finds the market with the lowest cost for the given duration.
     *
     * @param markets - Array of markets to search
     * @param targetMinutes - Desired rental duration in minutes
     * @returns Best market and cost, or null if none found
     *
     * Why duration matching:
     * Markets offer different rental periods (1h, 1d, 7d, 30d). Users might ask for 7 days,
     * so we need to find the best price for that specific duration.
     *
     * Algorithm explanation:
     * Initializes bestCost to Infinity, then iterates through all markets. For each active market
     * with matching duration, compares its cost against the current best. Uses < comparison to find
     * the MINIMUM (cheapest) cost. Returns the market with the lowest cost, or null if no matches found.
     */
    private findBestMarket(
        markets: IMarket[],
        targetMinutes: number
    ): { market: IMarket; costTRX: number } | null {
        let bestMarket: IMarket | null = null;
        let bestCost = Infinity;

        this.logger.debug(
            {
                targetMinutes,
                totalMarkets: markets.length,
                activeMarkets: markets.filter(m => m.isActive).length
            },
            'Finding best market for duration'
        );

        for (const market of markets) {
            if (!market.isActive || !market.pricingDetail?.usdtTransferCosts) {
                this.logger.debug(
                    {
                        marketName: market.name,
                        isActive: market.isActive,
                        hasPricing: !!market.pricingDetail?.usdtTransferCosts
                    },
                    'Skipping market (inactive or no pricing)'
                );
                continue;
            }

            // Find exact duration match
            const matchingCost = market.pricingDetail.usdtTransferCosts.find(
                c => c.durationMinutes === targetMinutes
            );

            if (matchingCost) {
                this.logger.debug(
                    {
                        marketName: market.name,
                        cost: matchingCost.costTrx,
                        currentBest: bestCost,
                        willUpdate: matchingCost.costTrx < bestCost
                    },
                    'Found matching duration'
                );

                if (matchingCost.costTrx < bestCost) {
                    bestMarket = market;
                    bestCost = matchingCost.costTrx;
                }
            } else {
                this.logger.debug(
                    {
                        marketName: market.name,
                        availableDurations: market.pricingDetail.usdtTransferCosts.map(c => c.durationMinutes)
                    },
                    'Market does not offer requested duration'
                );
            }
        }

        if (bestMarket) {
            this.logger.info(
                {
                    marketName: bestMarket.name,
                    cost: bestCost,
                    targetMinutes
                },
                'Selected cheapest market'
            );
        } else {
            this.logger.warn(
                { targetMinutes },
                'No markets found for requested duration'
            );
        }

        return bestMarket ? { market: bestMarket, costTRX: bestCost } : null;
    }

    /**
     * Generates a Telegram-formatted response for a market price query.
     *
     * @param options - Query parameters (transfer count, days, chat ID)
     * @returns Formatted message string for Telegram bot
     *
     * Why this method exists:
     * Telegram messages have specific formatting constraints (MarkdownV2, character limits).
     * This method encapsulates all formatting logic in one place.
     */
    async queryMarkets(options: IMarketQueryOptions): Promise<string> {
        const { transferCount = 1, days = 1 } = options;

        this.logger.info({ transferCount, days }, 'Processing market query');

        const markets = await this.fetchMarkets();

        if (markets.length === 0) {
            return '⚠️ No market data available. Please try again later.';
        }

        // Calculate target duration in minutes
        const targetMinutes = days * 24 * 60;

        // Find best market for this duration
        const result = this.findBestMarket(markets, targetMinutes);

        if (!result) {
            return `⚠️ No markets found for ${days} day rental.`;
        }

        // Format response with HTML formatting
        const costPerTransfer = result.costTRX;
        const totalCost = costPerTransfer * transferCount;

        let message = `💰 <b>Cheapest Market Price</b>\n\n`;
        message += `<b>Provider:</b> ${result.market.name}\n`;
        message += `<b>Duration:</b> ${days} day${days > 1 ? 's' : ''}\n`;
        message += `<b>Transfers:</b> ${transferCount}\n`;
        message += `<b>Cost per transfer:</b> ${costPerTransfer.toFixed(6)} TRX\n`;
        message += `<b>Total cost:</b> ${totalCost.toFixed(6)} TRX`;

        return message;
    }
}
