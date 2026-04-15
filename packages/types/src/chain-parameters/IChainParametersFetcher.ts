import type { IChainParameters } from './IChainParameters.js';

/**
 * Fetcher interface for retrieving chain parameters from TRON network
 * Implementations should poll TronGrid API and calculate derived values
 */
export interface IChainParametersFetcher {
    /**
     * Fetch current chain parameters from blockchain
     * Should calculate energyPerTrx ratio and save to database
     * @returns Freshly fetched chain parameters
     */
    fetch(): Promise<IChainParameters>;
}
