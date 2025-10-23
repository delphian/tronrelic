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
        costsByDuration?: Array<{
            minutes: number;
            costTRX: number;
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
     * Calculates energy cost for multiple USDT transfers over multiple days.
     * Accounts for TRON's 24-hour energy regeneration.
     *
     * @param baseEnergyCost - Energy cost for one USDT transfer (~65,000)
     * @param transferCount - Number of transfers
     * @param days - Number of days
     * @returns Total energy required
     *
     * Why regeneration matters:
     * TRON energy refills every 24 hours. A 7-day rental provides 7x the energy because
     * it regenerates daily. This calculation ensures accurate cost estimates.
     */
    private calculateTotalEnergy(baseEnergyCost: number, transferCount: number, days: number): number {
        // For multi-day rentals, energy regenerates daily
        // Total energy available = base energy * days
        // Energy needed per day = base energy * transfers per day
        // If spreading transfers over multiple days: transferCount / days per day
        // But typically users want: "cost for X transfers within Y days"
        // Simplest interpretation: cost for X transfers using Y days of regeneration
        return (baseEnergyCost * transferCount) / days;
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
     */
    private findBestMarket(
        markets: IMarket[],
        targetMinutes: number
    ): { market: IMarket; costTRX: number } | null {
        let bestMarket: IMarket | null = null;
        let bestCost = Infinity;

        for (const market of markets) {
            if (!market.isActive || !market.pricingDetail?.costsByDuration) {
                continue;
            }

            // Find exact duration match
            const matchingCost = market.pricingDetail.costsByDuration.find(
                c => c.minutes === targetMinutes
            );

            if (matchingCost && matchingCost.costTRX < bestCost) {
                bestMarket = market;
                bestCost = matchingCost.costTRX;
            }
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
            return '⚠️ No market data available\\. Please try again later\\.';
        }

        // Calculate target duration in minutes
        const targetMinutes = days * 24 * 60;

        // Find best market for this duration
        const result = this.findBestMarket(markets, targetMinutes);

        if (!result) {
            return `⚠️ No markets found for ${days} day rental\\.`;
        }

        // Format response
        const costPerTransfer = result.costTRX;
        const totalCost = costPerTransfer * transferCount;

        let message = `💰 *Cheapest Market Price*\\n\\n`;
        message += `*Provider:* ${this.escapeMarkdown(result.market.name)}\\n`;
        message += `*Duration:* ${days} day${days > 1 ? 's' : ''}\\n`;
        message += `*Transfers:* ${transferCount}\\n`;
        message += `*Cost per transfer:* ${costPerTransfer.toFixed(6)} TRX\\n`;
        message += `*Total cost:* ${totalCost.toFixed(6)} TRX\\n`;

        return message;
    }

    /**
     * Escapes special characters for Telegram MarkdownV2 format.
     *
     * @param text - Plain text string
     * @returns Escaped string safe for MarkdownV2
     *
     * Why escaping is critical:
     * MarkdownV2 treats certain characters as formatting (_, *, [, ], etc.).
     * Unescaped characters cause parse errors and message delivery failure.
     */
    private escapeMarkdown(text: string): string {
        return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
    }
}
