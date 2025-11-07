import type { MarketSnapshot } from '../../shared/types/market-snapshot.dto.js';

/**
 * Interface for market fetchers that pull data from third-party energy markets.
 *
 * Fetchers are initialized once with IPluginContext and reused for all fetch operations.
 * The context provides access to HTTP client, chain parameters, USDT parameters, logger, etc.
 */
export interface IMarketFetcher {
    readonly name: string;
    readonly guid: string;
    readonly timeoutMs: number;

    /**
     * Fetches market data from the upstream API, validates, and returns normalized snapshot.
     *
     * @returns Promise resolving to MarketSnapshot or null if fetch fails
     */
    fetch(): Promise<MarketSnapshot | null>;
}
