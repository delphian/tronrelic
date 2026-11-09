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
     * Get energy cost for a USDT transfer to a wallet whose USDT balance is currently zero
     *
     * Callers need this to price a transfer to a new or emptied wallet, which costs more
     * than a standard transfer because the recipient's balance is written into an empty
     * storage slot. The figure is measured on chain, not estimated from the standard cost.
     *
     * @returns Energy units required for a transfer to a zero-balance wallet
     */
    getFirstTimeTransferEnergy(): Promise<number>;
}
