import type { IUsdtParameters } from './IUsdtParameters.js';

/**
 * Interface for fetching USDT transaction parameters from TRON blockchain
 * Implementations query TronGrid API to determine actual energy costs
 */
export interface IUsdtParametersFetcher {
    /**
     * Fetch current USDT transfer energy costs from blockchain
     * Uses triggerconstantcontract to estimate energy for standard transfers
     *
     * @returns Freshly fetched USDT parameters including standard and first-time transfer costs
     * @throws Error if TronGrid API request fails
     */
    fetch(): Promise<IUsdtParameters>;
}
