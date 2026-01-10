import type { ISystemLogService } from '@/types';
import type { IMarketQueryOptions } from '../shared/index.js';
/**
 * Service for querying market data and formatting responses for Telegram bot.
 * Handles API calls to the markets endpoint and cost calculations based on user requests.
 *
 * Why this service exists:
 * Market data lives in the backend API, but the Telegram bot needs to access it without
 * tight coupling. This service abstracts the API call and provides formatted responses
 * suitable for Telegram messages.
 */
export declare class MarketQueryService {
    private readonly logger;
    private readonly apiBaseUrl;
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
    constructor(apiBaseUrl: string, logger: ISystemLogService);
    /**
     * Fetches current market data from the resource-markets plugin API.
     * Makes HTTP request to /api/plugins/resource-markets/markets endpoint.
     *
     * @returns Market data array or empty array on error
     *
     * Why error handling returns empty array:
     * Telegram bot should respond gracefully even if API is temporarily unavailable.
     * Empty array triggers "no markets available" message instead of crashing.
     *
     * Note: This is a temporary workaround using HTTP calls. See TODO.md for planned
     * inter-plugin service communication pattern that will replace this approach.
     */
    private fetchMarkets;
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
    private findBestMarket;
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
    queryMarkets(options: IMarketQueryOptions): Promise<string>;
}
//# sourceMappingURL=market-query.service.d.ts.map