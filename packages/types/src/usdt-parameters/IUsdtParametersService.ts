import type { IUsdtParameters } from './IUsdtParameters.js';

/**
 * Service interface for accessing cached USDT transaction parameters
 * Provides energy cost information for USDT transfers without querying blockchain
 */
export interface IUsdtParametersService {
    /**
     * Initialize the service by warming the cache from database.
     * Call this at startup to ensure methods have data available.
     * @returns true if cache was warmed successfully, false if no data in DB yet
     */
    init(): Promise<boolean>;

    /**
     * Get latest USDT parameters from cache or database
     * Cache refreshes every minute to balance performance vs freshness
     * Database is updated every 10 minutes by UsdtParametersFetcher
     *
     * @returns Latest USDT parameters from mainnet
     */
    getParameters(): Promise<IUsdtParameters>;

    /**
     * Get energy cost for a standard USDT transfer (to existing wallet)
     * Most common case for regular USDT transfers
     *
     * @returns Energy units required for standard transfer
     */
    getStandardTransferEnergy(): Promise<number>;

    /**
     * Get energy cost for first-time USDT transfer (to empty wallet)
     * Higher cost due to contract state initialization
     *
     * @returns Energy units required for first-time transfer
     */
    getFirstTimeTransferEnergy(): Promise<number>;
}
