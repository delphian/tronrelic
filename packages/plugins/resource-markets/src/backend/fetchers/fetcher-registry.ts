import type { IPluginContext } from '@tronrelic/types';
import type { IMarketFetcher } from './types.js';
import { TronSaveFetcher } from './implementations/tron-save.fetcher.js';
import { TronEnergyMarketFetcher } from './implementations/tron-energy-market.fetcher.js';
import { FeeeIoFetcher } from './implementations/feee-io.fetcher.js';
import { ApiTrxFetcher } from './implementations/api-trx.fetcher.js';
import { TronEnergizeFetcher } from './implementations/tron-energize.fetcher.js';
import { BrutusFinanceFetcher } from './implementations/brutus-finance.fetcher.js';
import { TronLendingFetcher } from './implementations/tron-lending.fetcher.js';
import { TronPulseFetcher } from './implementations/tron-pulse.fetcher.js';
import { TronEnergyFetcher } from './implementations/tron-energy.fetcher.js';
import { ErgonFetcher } from './implementations/ergon.fetcher.js';
import { TronFeeEnergyRentalFetcher } from './implementations/tron-fee-energy-rental.fetcher.js';
import { MeFreeNetFetcher } from './implementations/mefree-net.fetcher.js';
import { NitronEnergyFetcher } from './implementations/nitron-energy.fetcher.js';
import { TronifyFetcher } from './implementations/tronify.fetcher.js';

/**
 * Registry that manages all market fetchers.
 *
 * Fetchers are instantiated once during plugin init with IPluginContext injected.
 * The registry provides access to all fetchers for the market aggregator service.
 */
export class MarketFetcherRegistry {
    private fetchers: IMarketFetcher[] = [];

    constructor(private readonly context: IPluginContext) {}

    /**
     * Initializes all market fetchers with the plugin context.
     *
     * Called once during plugin initialization. Fetchers receive:
     * - HTTP client (axios instance)
     * - Logger (scoped to plugin)
     * - Chain parameters service
     * - USDT parameters service
     * - Cache service
     *
     * Add new fetcher instantiations here as they are migrated.
     */
    initialize(): void {
        this.fetchers = [
            new TronSaveFetcher(this.context),
            new TronEnergyMarketFetcher(this.context),
            new FeeeIoFetcher(this.context),
            new ApiTrxFetcher(this.context),
            new TronEnergizeFetcher(this.context),
            new BrutusFinanceFetcher(this.context),
            new TronLendingFetcher(this.context),
            new TronPulseFetcher(this.context),
            new TronEnergyFetcher(this.context),
            new ErgonFetcher(this.context),
            new TronFeeEnergyRentalFetcher(this.context),
            new MeFreeNetFetcher(this.context),
            new NitronEnergyFetcher(this.context),
            new TronifyFetcher(this.context)
        ];

        this.context.logger.info({ count: this.fetchers.length }, 'Market fetchers initialized');
    }

    /**
     * Returns all registered fetchers.
     *
     * @returns Array of market fetcher instances
     */
    list(): IMarketFetcher[] {
        return this.fetchers;
    }

    /**
     * Finds a fetcher by its GUID.
     *
     * @param guid - Unique market identifier
     * @returns Fetcher instance or undefined if not found
     */
    findByGuid(guid: string): IMarketFetcher | undefined {
        return this.fetchers.find(f => f.guid === guid);
    }
}
